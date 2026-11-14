# hdr-exposure-mapper

零依赖的纯 CPU Node.js HDR 图像处理库。只处理**线性 RGBA `Float32Array` 缓冲**，
不依赖 GPU、不包含任何查看器或图像编解码。流水线为：

1. 基于亮度直方图（中心加权 + 可配置百分位）计算自动曝光值 EV；
2. 帧间对 EV 施加上升/下降速率限制，抑制场景切换闪烁；
3. 应用色调映射曲线压缩高光（Reinhard 或 ACES）；
4. 线性光转 sRGB 传递函数；
5. 可选 4×4 Bayer 有序抖动后量化为 8-bit，也可直接输出浮点。

## 安装与测试

```bash
npm test          # 等价于 node --test
```

纯 ESM 包，Node >= 18，无第三方依赖。

## 快速上手

```js
import { HDRPipeline, processFrame } from 'hdr-exposure-mapper';

// 无状态：单帧
const result = processFrame(rgbaFloat32, width, height, {
  toneMapper: 'aces',
  output: 'uint8',   // 或 'float'
  dither: true,
});
result.data;         // Uint8ClampedArray / Float32Array，已是 sRGB
result.ev;           // 本帧使用的曝光值（stops）
result.gain;         // 曝光增益 = 2^-ev（无量纲倍数）

// 有状态：连续帧，自动做帧间速率限制
const pipeline = new HDRPipeline({
  controller: { maxEVIncrease: 0.5, maxEVDecrease: 1.0 },
});
for (const frame of frames) {
  const out = pipeline.process(frame.buffer, frame.width, frame.height);
}
```

## 单位与约定

### 输入缓冲

- 类型必须是 `Float32Array`，像素布局为紧密排列的 RGBA，长度 = `width * height * 4`。
- RGB 是**线性光**场景值（非 sRGB 编码），非负、有限，允许超过 1 的 HDR 高光。
- Alpha 仅做有限/非负校验，默认原样透传，不参与曝光与色调映射。

### 亮度与直方图

- 亮度使用 Rec.709 线性系数：`Y = 0.2126 R + 0.7152 G + 0.0722 B`，单位与输入相同（线性场景亮度）。
- 直方图在 **log2（stops）空间均匀分桶**，默认 256 桶，覆盖
  `minLuminance = 1e-4` 到 `maxLuminance = 1e4` 线性单位。
- 低于/高于范围的权重分别计入 `underflow` / `overflow`，并在求百分位时折叠到两端；
  **权重为 0 的空桶会被跳过**，不会污染百分位结果。
- `centerWeight`（0–1）：0 表示全图均匀加权；1 表示完全按到画面中心的距离加权
  （中心权重 1，角点权重 0）。空间权重为
  `(1 - centerWeight) + centerWeight * (1 - dist/cornerDist)`。

### 曝光值 EV（stops）

- 曝光值单位是 **stops（档，log2 尺度）**，定义为
  `EV = log2(L_percentile / targetLuminance)`，并被夹到 `[minEV, maxEV]`（默认 ±12 stops）。
- `percentile`（默认 50，即中位数）选择驱动测光的亮度百分位，取值范围 `(0, 100]`。
- `targetLuminance`（默认 0.18）是希望该百分位映射到的**线性**目标亮度（18% 灰）。
- 帧越亮 EV 越大；管线施加的曝光增益为 **`gain = 2^-EV`（无量纲线性倍数）**，
  即进入色调曲线的值 = `场景值 × gain`。

### 帧间速率限制

- `maxEVIncrease` / `maxEVDecrease` 单位均为 **stops/帧**，必须为正。
  - Increase：EV 上升（场景变亮、增益下降），默认 0.5，切换到亮场景时收敛更克制；
  - Decrease：EV 下降（场景变暗、增益上升），默认 1.0，暗场恢复更快。
- 首帧默认直接吸附到测光 EV（`limitFirstFrame: false`）；设为 `true` 则首帧也受速率限制。
- 每帧返回状态包含 `ev`（实际使用）、`targetEV`（测光目标）、`converged`、`held`、`blackFrame`。

### 色调映射曲线（输入为曝光后线性光，输出线性 [0,1]）

两条曲线都对同一曝光后的 RGB 逐通道施加同一个单调函数，因此灰阶
（R=G=B）输出始终保持 R=G=B，**不产生色相偏移**；再经 sRGB 与抖动避免断带。

- `reinhard`（默认）：单调有界 Reinhard，
  `f(x) = (x + a x²) / (1 + x + a x²)`，其中 `a = 1 / whitePoint²`。
  严格单调、有限输入下满足 `0 <= f(x) < 1`、渐近趋近 1，无需事后 clamp。
  `whitePoint` 是**线性光**单位的肩部参数，默认 4。
- `aces`：Narkowicz ACES filmic 近似，输入为曝光后线性光，输出线性 [0,1]，
  单调有界，高光肩部自然滚降。

### sRGB 与抖动

- 色调映射输出仍是线性光，再用标准 sRGB 传递函数分段编码
  （`c <= 0.0031308` 走线性段，否则走 1/2.4 幂段），结果在 [0,1]。
- `output: 'uint8'`（默认）量化到 0–255；`dither: true` 时在量化前加入
  确定性 4×4 Bayer 有序抖动阈值，同一 `(x, y)` 永远得到相同阈值，结果可复现。
- `output: 'float'` 返回 sRGB 编码后的 `Float32Array`，不做量化/抖动。

## 异常与边界行为

| 情况 | 行为 |
| --- | --- |
| RGB 含 `NaN` / `±Infinity` | 抛出 `RangeError`，指出像素下标 |
| RGB 为负值 | 抛出 `RangeError` |
| Alpha 非有限或为负 | 抛出 `RangeError` |
| 缓冲不是 `Float32Array` / 长度不匹配 | 抛出 `TypeError` / `RangeError` |
| `width`/`height` 非正整数 | 抛出 `RangeError` |
| 像素数超过 `maxPixels`（默认 4,000,000） | 抛出 `RangeError`（超预算） |
| 全黑帧（所有亮度为 0） | 测光返回 `null`；控制器**保持上一帧 EV**，标记 `blackFrame/held`；无状态入口以 gain=1 输出确定性全黑 |
| 直方图全为空桶 | 等价全黑，`percentileLuminance` 返回 `null`，不做除法 |
| 百分位越界 | `percentileLuminance` 对 `(0,100]` 之外的值抛 `RangeError` |
| 速率限制非正 | 构造 `ExposureController` 时抛 `RangeError` |

## API 概览

- `processFrame(buffer, width, height, options?)`：无状态单帧处理。
- `new HDRPipeline(options).process(buffer, width, height)`：带帧间速率限制的流式处理。
- `buildHistogram` / `percentileLuminance` / `computeExposure`：可单独组合的纯函数。
- `ExposureController`：可独立驱动的 EV 控制器（`update(histogram)` / `reset()`）。
- `reinhardExtended` / `acesNarkowicz` / `linearToSrgb` / `quantize8`：底层算子。

## 测试覆盖

`test/` 使用 `node:test` + `node:assert`，覆盖暗场、渐变灰阶 ramp、孤立高光、
场景突变、连续曝光变化，以及曝光收敛、单调性、输出范围与确定性，并对所有非法
输入类（NaN、负值、无穷、全黑、超预算尺寸、零分桶直方图）断言明确行为。
