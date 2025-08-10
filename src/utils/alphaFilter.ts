import * as PIXI from "pixi.js";

// 把整帧输出为“灰度 = 原始 alpha”
export function createAlphaOnlyFilter() {
    return new PIXI.Filter(undefined, `
    precision mediump float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    void main() {
      vec4 c = texture2D(uSampler, vTextureCoord);
      float a = c.a;
      gl_FragColor = vec4(a, a, a, 1.0);
    }
  `);
}
