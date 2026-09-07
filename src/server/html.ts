export interface HtmlConfig {
  debug: boolean;
  version: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(
  config: HtmlConfig,
  options: { head?: string; content?: string; scripts?: string; },
): string {
  const stylesheet = config.debug
    ? "/css/index.css"
    : `/css/gif.gg.css?${encodeURIComponent(config.version)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="initial-scale = 1.0">
  <title>gif.gg</title>
  ${options.head ?? ""}
  <link rel="shortcut icon" href="/favicon.png" type="image/png">
  <link rel="stylesheet" href="//fonts.googleapis.com/css?family=Droid+Sans:400,700">
  <link rel="stylesheet" href="${stylesheet}">
</head>
<body${config.debug ? " data-development=\"true\"" : ""}>
  <h1><a href="/">gif.gg</a></h1>
  ${options.content ?? ""}
  <footer><a href="/about">about</a></footer>
  ${options.scripts ?? ""}
</body>
</html>`;
}

export function renderMain(config: HtmlConfig): string {
  return layout(config, {
    scripts: `<script type="module" src="/js/gif.gg.js?${
      encodeURIComponent(config.version)
    }"></script>`,
  });
}

export function renderAbout(config: HtmlConfig): string {
  return layout(config, {
    content: `<div class="about">
  <p>by <a href="http://bpier.re/">Pierre Bertet</a> (<a href="mailto:hi@bpier.re" title="hi@bpier.re">@</a>, <a href="https://twitter.com/bpierre" title="X (formerly Twitter)">x</a>, <a href="https://github.com/bpierre" title="GitHub">gh</a>)</p>
  <p>gif.gg is <a href="https://github.com/bpierre/gif.gg">open source</a> ☺</p>
</div>
<p><a href="/">Make a new gif</a></p>`,
  });
}

export function renderGif(config: HtmlConfig, id: string): string {
  const escapedId = escapeHtml(id);
  const gifUrl = `/${escapedId}.gif`;

  return layout(config, {
    head: `<meta name="twitter:card" content="player">
  <meta name="twitter:site" content="@_gifgg">
  <meta name="twitter:title" content="gif.gg/${escapedId}">
  <meta name="twitter:player" content="https://gif.gg/twitter-player/${escapedId}">
  <meta name="twitter:player:width" content="320">
  <meta name="twitter:player:height" content="240">
  <meta name="twitter:image" content="https://gif.gg${gifUrl}">
  <meta property="og:image" content="https://gif.gg${gifUrl}">`,
    content: `<div class="single">
  <a href="${gifUrl}"><img src="${gifUrl}" alt=""></a>
</div>
<p><a href="/">Make a new gif</a></p>`,
  });
}

export function renderTwitterPlayer(id: string): string {
  const escapedId = escapeHtml(id);
  const gifUrl = `/${escapedId}.gif`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>gif.gg</title>
  <meta name="viewport" content="initial-scale=1, width=device-width">
  <link rel="shortcut icon" href="/favicon.png" type="image/png">
  <style>
    html, body { height: 100%; }
    body, img, a { display: block; margin: 0 auto; width: 320px; }
    img { position: absolute; margin: auto; top: 0; bottom: 0; }
  </style>
</head>
<body>
  <a href="https://gif.gg/${escapedId}" target="_blank"><img src="${gifUrl}" alt=""></a>
</body>
</html>`;
}

export function renderError(config: HtmlConfig, status: number): string {
  const message = status === 404
    ? "Sorry, the page you are looking for is not available."
    : "Sorry, but something went terribly wrong.";

  return layout(config, {
    content: `<p>${message}</p>
<p><a href="/">Make a new gif</a></p>`,
  });
}
