import hljs from 'highlight.js/lib/common';
import renderMathInElement from 'katex/contrib/auto-render';

const webviewGlobal = globalThis as typeof globalThis & {
  hljs: typeof hljs;
  renderMathInElement: typeof renderMathInElement;
};

webviewGlobal.hljs = hljs;
webviewGlobal.renderMathInElement = renderMathInElement;
