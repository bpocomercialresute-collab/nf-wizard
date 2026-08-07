declare module "jscanify" {
  interface CornerPoints {
    topLeftCorner:     { x: number; y: number };
    topRightCorner:    { x: number; y: number };
    bottomLeftCorner:  { x: number; y: number };
    bottomRightCorner: { x: number; y: number };
  }

  class jscanify {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findPaperContour(img: any): any | null;
    highlightPaper(
      image: HTMLElement,
      options?: { color?: string; thickness?: number },
    ): HTMLCanvasElement;
    extractPaper(
      image: HTMLElement,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: CornerPoints,
    ): HTMLCanvasElement | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getCornerPoints(contour: any): CornerPoints;
  }

  export = jscanify;
}
