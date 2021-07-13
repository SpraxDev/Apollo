export type ColorRGB = { r: number, g: number, b: number };
export type ColorXYZ = { x: number, y: number, z: number };
export type ColorLab = { L: number, a: number, b: number };

/**
 * @author NudelErde (https://github.com/NudelErde)
 */
export class Color {
  static RGBtoXYZ(c: ColorRGB) {
    // RGB Working Space: sRGB
    // Reference White: D65
    return {
      x: 0.412453 * c.r + 0.357580 * c.g + 0.189423 * c.b,
      y: 0.212671 * c.r + 0.715160 * c.g + 0.072169 * c.b,
      z: 0.019334 * c.r + 0.119193 * c.g + 0.950227 * c.b
    };
  }

  // XYZ to CIELab
  static XYZtoLab(c: ColorXYZ): ColorLab {
    const Xo = 244.66128; // Reference white
    const Yo = 255.0;
    const Zo = 277.63227;

    return {
      L: 116 * this.f(c.y / Yo) - 16,
      a: 500 * (this.f(c.x / Xo) - this.f(c.y / Yo)),
      b: 200 * (this.f(c.y / Yo) - this.f(c.z / Zo))
    };
  }

  // RGB to CIELab
  static RGBtoLab(c: ColorRGB): ColorLab {
    return this.XYZtoLab(this.RGBtoXYZ(c));
  }

  static deltaE(c1: ColorRGB, c2: ColorRGB): number {
    return Math.sqrt(this.deltaESquared(c1, c2));
  }

  static deltaESquared(c1: ColorRGB, c2: ColorRGB): number {
    const c1Lab = this.RGBtoLab(c1);
    const c2Lab = this.RGBtoLab(c2);

    const dL = c1Lab.L - c2Lab.L;
    const da = c1Lab.a - c2Lab.a;
    const db = c1Lab.b - c2Lab.b;

    return dL * dL + da * da + db * db;
  }

  private static f(input: number): number {
    return input > 0.008856 ? Math.cbrt(input) : (841 / 108) * input + 4 / 29;
  }
}
