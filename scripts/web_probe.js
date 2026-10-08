/* Read-only page snapshot. Load in a browser, then call webProbe({selector}).
 * This is not a network capture tool or a complete design-token extractor. */
(function () {
  'use strict';
  const fields = ['display', 'position', 'color', 'background', 'font-family',
    'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding',
    'margin', 'border', 'border-radius', 'box-shadow', 'filter', 'backdrop-filter',
    'transform', 'opacity', 'visibility', 'overflow', 'gap', 'flex-direction',
    'justify-content', 'align-items', 'grid-template-columns'];
  const styles = (element, pseudo) => {
    const computed = getComputedStyle(element, pseudo);
    const values = Object.fromEntries(fields.map(key => [key, computed.getPropertyValue(key)]));
    const variables = Array.from(computed).filter(key => key.startsWith('--'));
    values.variables_total = variables.length;
    values.variables_truncated = variables.length > 64;
    values.variables = Object.fromEntries(variables.slice(0, 64).map(key => [key, computed.getPropertyValue(key)]));
    return values;
  };
  const locationOnly = value => {
    try {
      const url = new URL(value, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.origin + url.pathname : url.protocol;
    } catch { return 'unavailable'; }
  };
  window.webProbe = function ({selector = 'body', maxElements = 200} = {}) {
    const report = {
      schema_version: 1, kind: 'web-snapshot', observed_at: new Date().toISOString(),
      context: {url: locationOnly(location.href), viewport: {width: innerWidth, height: innerHeight},
        dpr: devicePixelRatio, scroll: {x: scrollX, y: scrollY}, language: document.documentElement.lang || navigator.language,
        preferred_color_scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'},
      elements: [], animations: [], resources: [], truncated: false,
      warnings: ['Computed styles are resolved values, not original authored CSS.',
        'Closed shadow roots and iframe contents are not collected.',
        'No text/input values collected; CSS, element IDs and URL paths still require privacy review.',
        'Resources describe page-wide visible timing entries, not full requests or scoped feature ownership.']
    };
    if (typeof selector !== 'string' || !Number.isInteger(maxElements) || maxElements < 1 || maxElements > 10000) {
      report.warnings.push('Invalid selector type or maxElements; expected string and integer 1..10000.');
      return report;
    }
    let root;
    try { root = document.querySelector(selector); }
    catch { report.warnings.push('Invalid selector.'); return report; }
    if (!root) { report.warnings.push('No matching element.'); return report; }
    const nodes = new Map();
    // Bound traversal itself, not only its output, on large documents.
    const visit = (element, path) => {
      if (nodes.size >= maxElements) { report.truncated = true; return; }
      const index = nodes.size;
      nodes.set(element, index);
      const rect = element.getBoundingClientRect();
      report.elements.push({index, path, tag: element.localName, id: element.id,
        rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
        style: styles(element), pseudo: {before: styles(element, '::before'), after: styles(element, '::after')}});
      if (element.localName === 'iframe') report.warnings.push('iframe at ' + path + ' not traversed.');
      for (let child = element.firstElementChild, n = 0; child; child = child.nextElementSibling, n++) {
        if (nodes.size >= maxElements) { report.truncated = true; break; }
        visit(child, path + '/child[' + n + ']');
      }
      if (element.shadowRoot) {
        for (let child = element.shadowRoot.firstElementChild, n = 0; child; child = child.nextElementSibling, n++) {
          if (nodes.size >= maxElements) { report.truncated = true; break; }
          visit(child, path + '/shadow[' + n + ']');
        }
      }
    };
    visit(root, selector);
    const animations = new Set(document.getAnimations());
    for (const element of nodes.keys()) {
      if (element.shadowRoot && element.shadowRoot.getAnimations) {
        for (const animation of element.shadowRoot.getAnimations()) animations.add(animation);
      }
    }
    for (const animation of animations) {
      const effect = animation.effect;
      if (!effect || !nodes.has(effect.target)) continue;
      report.animations.push({target: nodes.get(effect.target), name: animation.animationName || animation.transitionProperty || null,
        play_state: animation.playState, current_time: animation.currentTime,
        timing: effect.getTiming(), keyframes: effect.getKeyframes()});
    }
    const resources = performance.getEntriesByType('resource');
    report.resources_truncated = resources.length > 200;
    report.resources = resources.slice(0, 200).map(entry => ({url: locationOnly(entry.name),
      type: entry.initiatorType, start_time: entry.startTime, duration: entry.duration,
      transfer_size: entry.transferSize, encoded_body_size: entry.encodedBodySize,
      decoded_body_size: entry.decodedBodySize}));
    report.warnings.push('Zero resource sizes may indicate cache or access restrictions; entries may have been evicted.');
    // JSON cannot encode Infinity (for example infinite animation iterations).
    return JSON.parse(JSON.stringify(report, (key, value) =>
      typeof value === 'number' && !Number.isFinite(value) ? String(value) : value));
  };
})();
