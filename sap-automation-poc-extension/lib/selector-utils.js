// Shared selector generation/lookup logic, used by content.js (classic script, no ES modules
// so it can be injected via chrome.scripting.executeScript alongside content.js).
(function (global) {
  function cssEscape(value) {
    if (global.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/([ #.;?%&,+*~':"!^$[\]()=>|/\\])/g, '\\$1');
  }

  function isUnique(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  // Check if an ID is dynamic (SAP UI5, Angular, etc.)
  function isDynamicId(id) {
    if (!id) return true;
    // SAP UI5: _item1459__clone2349, --someId, etc.
    if (/^_/.test(id) || /__/.test(id) || /^--/.test(id)) return true;
    // Angular: ng-xxx, ng-content
    if (/^ng-/.test(id)) return true;
    // React: r-xxx
    if (/^r-/.test(id)) return true;
    return false;
  }

  function buildCssPath(el) {
    if (!(el instanceof Element)) return '';
    const path = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'HTML') {
      // Use ID only if it's stable (not dynamic)
      if (node.id && !isDynamicId(node.id)) {
        path.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      let selector = node.tagName.toLowerCase();
      let nth = 1;
      let sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) nth++;
      }
      selector += `:nth-of-type(${nth})`;
      path.unshift(selector);
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  function buildXPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  function getShortText(el) {
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return text.slice(0, 60);
  }

  function generateSelectors(el) {
    const doc = el.ownerDocument;
    const selectors = {};

    if (el.id) {
      const sel = `#${cssEscape(el.id)}`;
      if (isUnique(sel, doc)) selectors.id = sel;
    }

    const testIdAttr = ['data-testid', 'data-test', 'data-qa'].find((attr) => el.getAttribute(attr));
    if (testIdAttr) {
      const sel = `[${testIdAttr}="${cssEscape(el.getAttribute(testIdAttr))}"]`;
      if (isUnique(sel, doc)) selectors.dataTestId = sel;
    }

    // SAP UI5 specific attributes
    const sapId = el.getAttribute('id') || el.getAttribute('data-sap-id');
    if (sapId && !el.id) {
      const sel = `[data-sap-id="${cssEscape(sapId)}"]`;
      if (isUnique(sel, doc)) selectors.sapId = sel;
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const sel = `[aria-label="${cssEscape(ariaLabel)}"]`;
      if (isUnique(sel, doc)) selectors.ariaLabel = sel;
    }

    const role = el.getAttribute('role');
    if (role) {
      selectors.role = role;
    }

    const name = el.getAttribute('name');
    if (name) {
      const sel = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUnique(sel, doc)) selectors.name = sel;
    }

    // Store row text for table context (helps find radio buttons in table rows)
    const row = el.closest('tr');
    if (row) {
      const cells = row.querySelectorAll('td, th');
      const cellTexts = [];
      cells.forEach((c) => {
        const t = (c.textContent || '').trim().replace(/\s+/g, ' ');
        if (t) cellTexts.push(t);
      });
      selectors.rowTexts = cellTexts;
    }

    selectors.css = buildCssPath(el);
    selectors.xpath = buildXPath(el);
    selectors.text = getShortText(el);

    return selectors;
  }

  function pickBestSelector(selectors) {
    return selectors.id || selectors.sapId || selectors.ariaLabel || selectors.dataTestId || selectors.name || selectors.css || selectors.xpath || '';
  }

  function findElement(selectors) {
    const candidates = [selectors.id, selectors.sapId, selectors.ariaLabel, selectors.dataTestId, selectors.name, selectors.css];
    for (const sel of candidates) {
      if (!sel) continue;
      try {
        const found = document.querySelector(sel);
        if (found) return found;
      } catch (e) {
        // invalid/stale selector, try next candidate
      }
    }
    if (selectors.xpath) {
      try {
        const result = document.evaluate(
          selectors.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch (e) {
        // ignore
      }
    }

    // Fallback: try CSS selector with dynamic IDs replaced by attribute selectors
    // e.g. #_item1459__clone2349-selectSingle > div:nth-of-type(1)
    // becomes [id*="_item"][id*="-selectSingle"] > div:nth-of-type(1)
    if (selectors.css && selectors.css.includes('#')) {
      const parts = selectors.css.split(' > ');
      const newParts = [];
      let hasReplacement = false;
      for (const part of parts) {
        // Match #dynamicId pattern (e.g. #_item1459__clone2349-selectSingle)
        const hashMatch = part.match(/^(#)(.+)$/);
        if (hashMatch && isDynamicId(hashMatch[2])) {
          const fullId = hashMatch[2];
          const attrSelectors = [];
          // Prefix: stable text before first number (_item, --, ng-, r-)
          const prefixMatch = fullId.match(/^([a-zA-Z_-]+?)[0-9]/);
          if (prefixMatch) {
            attrSelectors.push(`[id*="${prefixMatch[1]}"]`);
          }
          // Suffix: stable text after last number (-selectSingle, -input, etc.)
          const suffixMatch = fullId.match(/-([a-zA-Z][a-zA-Z0-9_-]+)$/);
          if (suffixMatch) {
            attrSelectors.push(`[id*="-${suffixMatch[1]}"]`);
          }
          // If no stable parts found, use first few chars
          if (attrSelectors.length === 0) {
            const shortPrefix = fullId.slice(0, 6);
            attrSelectors.push(`[id^="${shortPrefix}"]`);
          }
          newParts.push(attrSelectors.join(''));
          hasReplacement = true;
        } else {
          newParts.push(part);
        }
      }
      if (hasReplacement) {
        try {
          const found = document.querySelector(newParts.join(' > '));
          if (found) return found;
        } catch (e) { /* ignore */ }
      }
    }

    // Fallback 1: find by row text (for elements inside table rows, e.g. radio buttons)
    if (selectors.rowTexts && selectors.rowTexts.length > 0) {
      const rows = document.querySelectorAll('tr');
      const targetTexts = selectors.rowTexts;
      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        const cellTexts = [];
        cells.forEach((c) => {
          const t = (c.textContent || '').trim().replace(/\s+/g, ' ');
          if (t) cellTexts.push(t);
        });
        // Check if all target texts are found in this row
        const allMatch = targetTexts.every((t) => cellTexts.some((ct) => ct.includes(t)));
        if (allMatch && targetTexts.length > 0) {
          // Found matching row, now find the interactive element (radio, button, link, etc.)
          if (selectors.role === 'radio' || selectors.role === 'radiobutton') {
            const radio = row.querySelector('input[type="radio"], [role="radio"], svg circle, .sapMBRadioButton, .sapUiRadioButton');
            if (radio) return radio;
          }
          // Try to find any clickable element in the row
          const clickable = row.querySelector('input, button, a, [role="button"], [role="radio"], [role="link"], [tabindex="0"]');
          if (clickable) return clickable;
          // Return the row itself as last resort
          return row;
        }
      }
    }

    // Fallback 2: find by text content (handles dynamic IDs like SAP UI5)
    if (selectors.text && selectors.text.length >= 3) {
      const targetText = selectors.text.trim();
      // Try common interactive elements first
      const interactiveTags = 'button, input, a, span, div, td, li, label, select, textarea';
      const allElements = document.querySelectorAll(interactiveTags);
      for (const el of allElements) {
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text === targetText || text.startsWith(targetText)) {
          // Prefer smaller (more specific) elements
          if (el.childElementCount === 0 || el.querySelector(interactiveTags) === null) {
            return el;
          }
        }
      }
      // Second pass: accept any element containing the text
      for (const el of allElements) {
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text === targetText) {
          return el;
        }
      }
    }

    return null;
  }

  global.ToscaSelectorUtils = { generateSelectors, pickBestSelector, findElement, buildCssPath, buildXPath };
})(window);
