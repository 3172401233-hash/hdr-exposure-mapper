export function makeBuffer(width, height, pixelFn) {
  const buffer = new Float32Array(width * height * 4);
  let index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = pixelFn(x, y);
      buffer[index] = pixel[0];
      buffer[index + 1] = pixel[1];
      buffer[index + 2] = pixel[2];
      buffer[index + 3] = pixel.length > 3 ? pixel[3] : 1;
      index += 4;
    }
  }
  return buffer;
}

export function solidBuffer(width, height, r, g = r, b = r, a = 1) {
  return makeBuffer(width, height, () => [r, g, b, a]);
}

export function blackBuffer(width, height) {
  return new Float32Array(width * height * 4);
}

// Horizontal linear-light gray ramp from low to high.
export function grayRamp(width, height, low = 0, high = 1) {
  return makeBuffer(width, height, (x) => {
    const value = low + ((high - low) * x) / (width - 1);
    return [value, value, value, 1];
  });
}

export function distinctLevels(data, width, height, channel = 0) {
  const seen = new Set();
  for (let i = 0; i < width * height; i++) {
    seen.add(data[i * 4 + channel]);
  }
  return seen;
}
