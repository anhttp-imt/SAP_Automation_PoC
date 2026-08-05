// Injected on-demand into the target tab via chrome.scripting.executeScript.
// Depends on lib/selector-utils.js being injected first (exposes window.ToscaSelectorUtils).
(function () {
  if (window.__toscaPocContentLoaded) return;
  window.__toscaPocContentLoaded = true;

  let overlayEl = null;
  let labelEl = null;
  let runOverlayEl = null;

  function ensureOverlay() {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.className = 'tosca-poc-highlight-overlay';
      overlayEl.style.display = 'none';
      document.documentElement.appendChild(overlayEl);
    }
    if (!labelEl) {
      labelEl = document.createElement('div');
      labelEl.className = 'tosca-poc-highlight-label';
      labelEl.style.display = 'none';
      document.documentElement.appendChild(labelEl);
    }
  }

  function ensureRunOverlay() {
    if (!runOverlayEl) {
      runOverlayEl = document.createElement('div');
      runOverlayEl.className = 'tosca-poc-run-overlay';
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
      el.classList.contains('tosca-poc-highlight-overlay') ||
      el.classList.contains('tosca-poc-highlight-label') ||
      el.classList.contains('tosca-poc-run-overlay')
    );
  }

  // ---------------- Scan mode ----------------

  function onScanMouseMove(e) {
    const el = e.target;
    if (isIgnorableElement(el)) return;
    ensureOverlay();
    positionOverlay(el, overlayEl, labelEl);
  }

  function onScanClick(e) {
    const el = e.target;
    if (isIgnorableElement(el)) return;
    e.preventDefault();
    e.stopPropagation();
    const selectors = ToscaSelectorUtils.generateSelectors(el);
    const entry = {
      name: describeElement(el),
      selectors,
      tagName: el.tagName.toLowerCase(),
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
    'a[href]', 'button', 'input', 'select', 'textarea', 'label',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="switch"]', '[role="combobox"]',
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
      const selectors = ToscaSelectorUtils.generateSelectors(el);
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
    const el = ToscaSelectorUtils.findElement(selectors || {});
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
    const el = e.target;
    if (isIgnorableElement(el)) return;
    if (actionForElement(el) !== 'click') return; // text inputs recorded on change instead
    emitRecordedStep(el, 'click');
  }

  function onRecordChange(e) {
    const el = e.target;
    if (isIgnorableElement(el)) return;
    const action = actionForElement(el);
    if (action === 'input') emitRecordedStep(el, 'input', el.value);
    else if (action === 'select') emitRecordedStep(el, 'select', el.value);
  }

  function emitRecordedStep(el, action, value) {
    const selectors = ToscaSelectorUtils.generateSelectors(el);
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
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
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
    let el = ToscaSelectorUtils.findElement(selectors || {});
    let attempts = 0;
    const maxAttempts = 20; // up to 4 seconds
    while (!el && attempts < maxAttempts) {
      await sleep(200);
      el = ToscaSelectorUtils.findElement(selectors || {});
      attempts++;
    }

    if (!el) {
      return {
        status: 'fail',
        message: `Không tìm thấy element (selector: ${ToscaSelectorUtils.pickBestSelector(selectors || {})})`,
      };
    }
    // Scroll through all parent containers that might be clipping the element
    scrollElementIntoView(el);
    positionOverlay(el, runOverlayEl, null);
    await sleep(300);

    try {
      switch (step.action) {
        case 'click': {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy, buttons: 0 }));
          break;
        }
        case 'input': {
          let inputValue = step.value ?? '';
          if (inputValue.endsWith('{Enter}')) inputValue = inputValue.slice(0, -7);
          el.focus();
          setNativeValue(el, inputValue);
          // Always dispatch Enter to commit value in SAP UI
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          el.blur();
          break;
        }
        case 'select':
          el.value = step.value ?? '';
          el.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        case 'verify': {
          const actual = (el.innerText ?? el.value ?? '').trim();
          const expected = (step.expectedValue ?? step.value ?? '').trim();
          if (actual !== expected) {
            return { status: 'fail', message: `Verify thất bại: mong đợi "${expected}", thực tế "${actual}"` };
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
            // Try multiple strategies to get text content safely
            if (el.value !== undefined && el.value !== '') {
              extractedText = String(el.value).trim();
            } else if (el.textContent) {
              extractedText = el.textContent.trim();
            } else if (el.innerText) {
              extractedText = el.innerText.trim();
            } else {
              // Fallback: get child text nodes only (avoids triggering SAP UI5 getters)
              const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
              const texts = [];
              let node;
              while ((node = walker.nextNode())) {
                texts.push(node.textContent);
              }
              extractedText = texts.join('').trim();
            }
          } catch (e) {
            // Last resort: use outerText or nodeValue
            try {
              extractedText = String(el.textContent || el.firstChild?.nodeValue || '').trim();
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
          return { status: 'fail', message: `Action không hỗ trợ: ${step.action}` };
      }
    } catch (err) {
      return { status: 'fail', message: `Lỗi khi thực thi: ${err.message}` };
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
        sendResponse({ found: !!ToscaSelectorUtils.findElement(message.selectors || {}) });
        return;
      case 'BG_CHECK_PAGE_READY':
        sendResponse({ ready: document.readyState === 'complete' });
        return;
      default:
        return;
    }
  });
})();
