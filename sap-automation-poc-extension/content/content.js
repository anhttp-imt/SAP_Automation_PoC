// Injected on-demand into the target tab via chrome.scripting.executeScript.
// Depends on lib/selector-utils.js being injected first (exposes window.SapAutomationSelectorUtils).
(function () {
  if (window.__sapAutomationPocContentLoaded) return;
  window.__sapAutomationPocContentLoaded = true;

  let overlayEl = null;
  let labelEl = null;
  let runOverlayEl = null;
  let cursorEl = null;
  let rippleEl = null;

  function ensureOverlay() {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.className = 'sap-automation-poc-highlight-overlay';
      overlayEl.style.display = 'none';
      document.documentElement.appendChild(overlayEl);
    }
    if (!labelEl) {
      labelEl = document.createElement('div');
      labelEl.className = 'sap-automation-poc-highlight-label';
      labelEl.style.display = 'none';
      document.documentElement.appendChild(labelEl);
    }
  }

  function ensureRunOverlay() {
    if (!runOverlayEl) {
      runOverlayEl = document.createElement('div');
      runOverlayEl.className = 'sap-automation-poc-run-overlay';
      runOverlayEl.style.display = 'none';
      document.documentElement.appendChild(runOverlayEl);
    }
  }

  function positionOverlay(el, overlay, label) {
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    if (label) {
      label.style.display = 'block';
      label.style.left = `${rect.left}px`;
      label.style.top = `${Math.max(0, rect.top - 20)}px`;
      label.textContent = describeElement(el);
    }
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
  }

  function getWrappingLabelText(el) {
    const label = el.closest('label');
    if (!label) return '';
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
    return (clone.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function getSemanticName(el) {
    if (el.id) {
      try {
        const escapedId = window.CSS && CSS.escape ? CSS.escape(el.id) : el.id;
        const label = document.querySelector(`label[for="${escapedId}"]`);
        if (label) {
          const t = (label.textContent || '').trim().replace(/\s+/g, ' ');
          if (t) return t;
        }
      } catch (e) {
        // invalid id for selector, skip
      }
    }

    const wrapText = getWrappingLabelText(el);
    if (wrapText) return wrapText;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const ariaLabelledby = el.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      const ref = document.getElementById(ariaLabelledby);
      if (ref) {
        const t = (ref.textContent || '').trim().replace(/\s+/g, ' ');
        if (t) return t;
      }
    }
    
    // For buttons/links, the visible text IS the label - prefer it over placeholder/name                                                                
    const tag = el.tagName.toLowerCase();                                                                                                                
    const type = (el.getAttribute('type') || '').toLowerCase();                                                                                          
    const role = (el.getAttribute('role') || '').toLowerCase();                                                                                          
      const isButtonLike =                                                                                                                                 
      tag === 'button' ||                                                                                                                                
      tag === 'a' ||                                                                                                                                     
      (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) ||                                                                               
      ['button', 'link', 'tab', 'menuitem'].includes(role);                                                                                              
      if (isButtonLike) {                                                                                                                                  
        const btnText = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');                                                                      
        if (btnText) return btnText;                                                                                                                       
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    const name = el.getAttribute('name');
    if (name && name.trim()) return name.trim();

    return '';
  }

  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const semanticName = getSemanticName(el);
    if (semanticName) return semanticName.slice(0, 40);
    const idPart = el.id ? `#${el.id}` : '';
    const text = (el.innerText || el.value || '').trim().slice(0, 24);
    return `${tag}${idPart}${text ? ' "' + text + '"' : ''}`;
  }

  function isIgnorableElement(el) {
    return (
      !el ||
      el === document.documentElement ||
      el === document.body ||
      el.classList.contains('sap-automation-poc-highlight-overlay') ||
      el.classList.contains('sap-automation-poc-highlight-label') ||
      el.classList.contains('sap-automation-poc-run-overlay') ||
      el.classList.contains('sap-automation-poc-cursor') ||
      el.classList.contains('sap-automation-poc-click-ripple')
    );
  }

  // ---------------- Fake mouse cursor (playback visualization) ----------------
  // Purely cosmetic: shows a moving pointer + click ripple during BG_EXECUTE_STEP
  // so a human watching the run can follow along, similar to Tosca's execution view.

  const CURSOR_SVG =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 2 L3 18.5 L7.2 14.8 L10.2 21.5 L13.2 20.1 L10.2 13.4 L16 13.4 Z" ' +
    'fill="#ffffff" stroke="#1565c0" stroke-width="1.3" stroke-linejoin="round"/></svg>';

  function ensureCursor() {
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'sap-automation-poc-cursor';
      cursorEl.style.display = 'none';
      cursorEl.innerHTML = CURSOR_SVG;
      document.documentElement.appendChild(cursorEl);
    }
    if (!rippleEl) {
      rippleEl = document.createElement('div');
      rippleEl.className = 'sap-automation-poc-click-ripple';
      document.documentElement.appendChild(rippleEl);
    }
  }

  // Animate the cursor to (x, y). On its very first appearance it snaps there
  // instantly instead of flying in from the top-left corner.
  async function moveCursorTo(x, y) {
    ensureCursor();
    const isFirstAppearance = cursorEl.style.display === 'none';
    if (isFirstAppearance) {
      cursorEl.style.transition = 'none';
      cursorEl.style.display = 'block';
      cursorEl.style.left = `${x}px`;
      cursorEl.style.top = `${y}px`;
      void cursorEl.offsetWidth; // force reflow before restoring the transition
      cursorEl.style.transition = '';
      return;
    }
    cursorEl.style.left = `${x}px`;
    cursorEl.style.top = `${y}px`;
    await sleep(360); // roughly matches the CSS move transition duration
  }

  function pulseCursorPress() {
    if (!cursorEl) return;
    cursorEl.classList.add('sap-automation-poc-cursor-pressed');
    setTimeout(() => cursorEl.classList.remove('sap-automation-poc-cursor-pressed'), 150);
  }

  function showClickRipple(x, y) {
    ensureCursor();
    rippleEl.classList.remove('sap-automation-poc-click-ripple-animate');
    rippleEl.style.left = `${x}px`;
    rippleEl.style.top = `${y}px`;
    void rippleEl.offsetWidth; // restart the CSS animation
    rippleEl.classList.add('sap-automation-poc-click-ripple-animate');
  }

  // Click/hover events often land on an inner presentation node (e.g. the <bdi>
  // SAP UI5 wraps button text in) rather than the actual interactive control.
  // Walk up to the nearest real interactive ancestor so naming/selectors match
  // what Scan All already finds by querying SCANNABLE_SELECTOR directly.
  function resolveInteractiveElement(el) {
    if (!el || !el.closest) return el;
    if (el.matches && el.matches(SCANNABLE_SELECTOR)) return el;
    return el.closest(SCANNABLE_SELECTOR) || el;
  }

  // ---------------- Scan mode ----------------

  function onScanMouseMove(e) {
    const el = resolveInteractiveElement(e.target);
    if (isIgnorableElement(el)) return;
    ensureOverlay();
    positionOverlay(el, overlayEl, labelEl);
  }

  function onScanClick(e) {
    const el = resolveInteractiveElement(e.target);
    if (isIgnorableElement(el)) return;
    e.preventDefault();
    e.stopPropagation();
    const selectors = SapAutomationSelectorUtils.generateSelectors(el);
    const tagName = el.tagName.toLowerCase();
    const entry = {
      name: `${describeElement(el)} (${tagName})`,
      selectors,
      tagName,
      pageUrlPattern: location.origin + location.pathname,
      capturedAt: Date.now(),
    };
    chrome.runtime.sendMessage({ type: 'CS_OBJECT_CAPTURED', entry });
  }

  function enableScanMode() {
    ensureOverlay();
    document.addEventListener('mousemove', onScanMouseMove, true);
    document.addEventListener('click', onScanClick, true);
  }

  function disableScanMode() {
    document.removeEventListener('mousemove', onScanMouseMove, true);
    document.removeEventListener('click', onScanClick, true);
    hideOverlay();
  }

  // ---------------- Scan All mode ----------------

  const SCANNABLE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'label', 'li',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="switch"]', '[role="combobox"]',
    '[role="option"]', '[role="row"]', '[role="gridcell"]', '[role="treeitem"]',
    '[role="listitem"]',
    // SAPUI5 list-item rows (e.g. value-help/dropdown popup entries) use
    // roving tabindex="-1" and often no ARIA role, so they're otherwise invisible here.
    '.sapMLIB',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    return true;
  }

  function scanAllElements() {
    const seen = new Set();
    const results = [];
    const nodeList = document.querySelectorAll(SCANNABLE_SELECTOR);
    nodeList.forEach((el) => {
      if (isIgnorableElement(el) || seen.has(el)) return;
      seen.add(el);
      if (el.disabled) return;
      if (!isVisible(el)) return;
      const selectors = SapAutomationSelectorUtils.generateSelectors(el);
      results.push({
        name: describeElement(el),
        selectors,
        tagName: el.tagName.toLowerCase(),
        pageUrlPattern: location.origin + location.pathname,
        capturedAt: Date.now(),
      });
    });
    return results;
  }

  function highlightBySelectors(selectors) {
    const el = SapAutomationSelectorUtils.findElement(selectors || {});
    if (el) {
      ensureOverlay();
      positionOverlay(el, overlayEl, labelEl);
    } else {
      hideOverlay();
    }
  }

  // ---------------- Record mode ----------------

  function actionForElement(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'input' || tag === 'textarea') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return 'click';
      return 'input';
    }
    return 'click';
  }

  function onRecordClick(e) {
    const el = resolveInteractiveElement(e.target);
    if (isIgnorableElement(el)) return;
    if (actionForElement(el) !== 'click') return; // text inputs recorded on change instead
    emitRecordedStep(el, 'click');
  }

  function onRecordChange(e) {
    const el = resolveInteractiveElement(e.target);
    if (isIgnorableElement(el)) return;
    const action = actionForElement(el);
    if (action === 'input') emitRecordedStep(el, 'input', el.value);
    else if (action === 'select') emitRecordedStep(el, 'select', el.value);
  }

  function emitRecordedStep(el, action, value) {
    const selectors = SapAutomationSelectorUtils.generateSelectors(el);
    const objectEntry = {
      name: describeElement(el),
      selectors,
      tagName: el.tagName.toLowerCase(),
      pageUrlPattern: location.origin + location.pathname,
      capturedAt: Date.now(),
    };
    chrome.runtime.sendMessage({ type: 'CS_STEP_RECORDED', step: { action, value }, objectEntry });
  }

  function enableRecordMode() {
    document.addEventListener('click', onRecordClick, true);
    document.addEventListener('change', onRecordChange, true);
  }

  function disableRecordMode() {
    document.removeEventListener('click', onRecordClick, true);
    document.removeEventListener('change', onRecordChange, true);
  }

  // ---------------- Playback ----------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseKeySequence(str) {
    // Parse {Enter}{Tab}F5{F5} into ['Enter', 'Tab', 'F5', 'F5']
    const keys = [];
    const regex = /\{([^}]+)\}|(.)/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      keys.push(match[1] || match[2]);
    }
    return keys;
  }

  function setNativeValue(el, value) {
    // Resolve wrapper element to actual input (SAP UI5 wraps inputs in divs/spans)
    const target = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      ? el
      : el.querySelector('input, textarea');
    if (!target) return; // cannot find input to set value on
    const proto = Object.getPrototypeOf(target);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(target, value);
    else target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function scrollElementIntoView(el) {
    // First scroll the window to the element
    el.scrollIntoView({ block: 'center', behavior: 'instant' });

    // Then scroll all parent containers that might clip the element
    let node = el.parentElement;
    while (node) {
      const style = window.getComputedStyle(node);
      const overflow = style.overflow || style.overflowY;
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
        const rect = node.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        // If element is outside visible area of this container
        if (elRect.top < rect.top || elRect.bottom > rect.bottom) {
          const scrollTop = el.offsetTop - node.offsetTop - rect.height / 2;
          node.scrollTop = Math.max(0, scrollTop);
        }
      }
      // Stop at fixed/sticky positioned ancestors or body
      if (node === document.body || node === document.documentElement) break;
      if (style.position === 'fixed') break;
      node = node.parentElement;
    }

    // Final scroll to ensure element is visible
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  async function executeStep(step, selectors) {
    ensureRunOverlay();

    // Retry finding element (handles late-loading SPA content)
    let el = SapAutomationSelectorUtils.findElement(selectors || {});
    let attempts = 0;
    const maxAttempts = 20; // up to 4 seconds
    while (!el && attempts < maxAttempts) {
      await sleep(200);
      el = SapAutomationSelectorUtils.findElement(selectors || {});
      attempts++;
    }

    if (!el) {
      return {
        status: 'fail',
        message: `Element not found (selector: ${SapAutomationSelectorUtils.pickBestSelector(selectors || {})})`,
      };
    }
    // Scroll through all parent containers that might be clipping the element
    scrollElementIntoView(el);
    // Give smooth-scrolling containers a moment to settle before we measure anything.
    await sleep(100);

    function centerOf(target) {
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    const initialCenter = centerOf(el);
    const cx = initialCenter.x;
    const cy = initialCenter.y;
    // Only mouse-driven actions get the fake cursor; typing/waiting/etc. don't need it.
    const usesCursor = step.action === 'click' || step.action === 'select';
    if (usesCursor) {
      // Move the cursor first, then reveal the highlight once it arrives -
      // otherwise the highlight jumps to the target ahead of the cursor.
      await moveCursorTo(cx, cy);
      positionOverlay(el, runOverlayEl, null);
      await sleep(150);
    } else {
      positionOverlay(el, runOverlayEl, null);
      await sleep(300);
    }

    try {
      switch (step.action) {
        case 'click': {
          // Re-measure right before the click: the element may have shifted slightly
          // (layout settling, smooth scroll) since the cursor started moving toward it.
          const clickPoint = centerOf(el);
          pulseCursorPress();
          showClickRipple(clickPoint.x, clickPoint.y);
          // Dispatch PointerEvent (SAP UI5 newer controls) AND MouseEvent (legacy)
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: clickPoint.x, clientY: clickPoint.y, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true }));
          await sleep(80);
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: clickPoint.x, clientY: clickPoint.y, button: 0, buttons: 0, pointerType: 'mouse', isPrimary: true }));
          el.dispatchEvent(new PointerEvent('click', { bubbles: true, clientX: clickPoint.x, clientY: clickPoint.y, button: 0, buttons: 0, pointerType: 'mouse', isPrimary: true }));
          // Also dispatch MouseEvent for legacy controls
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clickPoint.x, clientY: clickPoint.y, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clickPoint.x, clientY: clickPoint.y, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: clickPoint.x, clientY: clickPoint.y, buttons: 0 }));
          break;
        }
        case 'input': {
          let inputValue = step.value ?? '';
          let shouldClearFirst = false;
          if (inputValue.startsWith('{Clear}')) {
            shouldClearFirst = true;
            inputValue = inputValue.slice(7);
          }
          if (inputValue.endsWith('{Enter}')) inputValue = inputValue.slice(0, -7);
          el.focus();
          // Clear input first if {Clear} prefix is present
          if (shouldClearFirst) {
            setNativeValue(el, '');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          setNativeValue(el, inputValue);
          // Always dispatch Enter to commit value in SAP UI
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.blur();
          break;
        }
        case 'select': {
          const selectPoint = centerOf(el);
          pulseCursorPress();
          showClickRipple(selectPoint.x, selectPoint.y);
          el.value = step.value ?? '';
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
        case 'verify': {
          const actual = (el.innerText ?? el.value ?? '').trim();
          const expected = (step.expectedValue ?? step.value ?? '').trim();
          if (actual !== expected) {
            return { status: 'fail', message: `Verify failed: expected "${expected}", actual "${actual}"` };
          }
          break;
        }
        case 'wait':
          await sleep(step.waitMs || 500);
          break;
        case 'extract': {
          // Extract text/value from element and return it for variable storage
          let extractedText = '';
          try {
            // Strategy 1: Use value property for inputs (safe, no getter trigger)
            if (el.value !== undefined && el.value !== '') {
              extractedText = String(el.value).trim();
            }
            // Strategy 2: Use treeWalker to get child text nodes only
            // This avoids triggering SAP UI5 getters on textContent/innerText
            else if (el.childNodes.length > 0) {
              const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
              const texts = [];
              let node;
              while ((node = walker.nextNode())) {
                texts.push(node.textContent);
              }
              extractedText = texts.join('').trim();
            }
            // Strategy 3: Fallback to innerText (may trigger re-render but needed for some cases)
            else {
              extractedText = (el.innerText || '').trim();
            }
          } catch (e) {
            // Last resort: use nodeValue
            try {
              extractedText = String(el.firstChild?.nodeValue || '').trim();
            } catch (e2) {
              extractedText = '';
            }
          }
          runOverlayEl.style.display = 'none';
          return { status: 'pass', message: `Extracted: "${extractedText}"`, extractedValue: extractedText };
        }
        case 'sendkey': {
          const keyStr = step.value ?? '';
          const keys = parseKeySequence(keyStr);
          for (const key of keys) {
            // Handle special keys that need direct actions (browser blocks default behavior for programmatic events)
            if (key === 'F5') {
              // F5 reload is handled by background script - don't reload here
              // This branch should not be reached if background handles F5 properly
              continue;
            }
            if (key === 'Tab') {
              // Tab changes focus - dispatch to document level
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
              document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
              await sleep(100);
              continue;
            }
            // For other keys, dispatch to activeElement, document, and window
            const targets = [document.activeElement, document, window].filter(Boolean);
            for (const target of targets) {
              target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
              target.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, bubbles: true }));
              target.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
            }
            await sleep(100);
          }
          break;
        }
        default:
          return { status: 'fail', message: `Action not supported: ${step.action}` };
      }
    } catch (err) {
      return { status: 'fail', message: `Execution error: ${err.message}` };
    }

    await sleep(150);
    runOverlayEl.style.display = 'none';
    return { status: 'pass', message: 'OK' };
  }

  // ---------------- Messaging ----------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'BG_PING':
        sendResponse({ ok: true });
        return;
      case 'BG_ENABLE_SCAN':
        enableScanMode();
        sendResponse({ ok: true });
        return;
      case 'BG_DISABLE_SCAN':
        disableScanMode();
        sendResponse({ ok: true });
        return;
      case 'BG_SCAN_ALL':
        sendResponse({ objects: scanAllElements() });
        return;
      case 'BG_HIGHLIGHT_ELEMENT':
        highlightBySelectors(message.selectors);
        sendResponse({ ok: true });
        return;
      case 'BG_UNHIGHLIGHT_ELEMENT':
        hideOverlay();
        sendResponse({ ok: true });
        return;
      case 'BG_ENABLE_RECORD':
        enableRecordMode();
        sendResponse({ ok: true });
        return;
      case 'BG_DISABLE_RECORD':
        disableRecordMode();
        sendResponse({ ok: true });
        return;
      case 'BG_EXECUTE_STEP':
        executeStep(message.step, message.selectors).then(sendResponse);
        return true; // keep the message channel open for the async response
      case 'BG_CHECK_ELEMENT':
        sendResponse({ found: !!SapAutomationSelectorUtils.findElement(message.selectors || {}) });
        return;
      case 'BG_CHECK_PAGE_READY':
        sendResponse({ ready: document.readyState === 'complete' });
        return;
      default:
        return;
    }
  });
})();
