/**
 * 仟徒男装 · 门店AI文案生成 (v3)
 * 流程: 拍照/选图 → AI识别 → 生成3版文案 → 结果展示 → 一键复制
 *
 * 依赖 Cloudflare Worker (menswear-copy-gen) 作为 Claude API 代理
 */
(function() {
  'use strict';

  // ===== 状态管理 =====
  var state = {
    phase: 'idle', // idle | uploading | analyzing | results | error
    selectedImages: [],
    result: null,
    errorMsg: ''
  };

  // DOM 引用
  var els = {};

  function $(id) { return document.getElementById(id); }

  function cacheElements() {
    els = {
      photoInput: $('prod-photos'),
      photoArea: $('photo-area'),
      previews: $('photo-previews'),
      photoCount: $('photo-count'),
      form: $('product-form'),
      btnGenerate: $('btn-generate'),
      stateUploading: $('state-uploading'),
      stateAnalyzing: $('state-analyzing'),
      stateError: $('state-error'),
      errorText: $('error-text'),
      btnRetry: $('btn-retry'),
      analysisSummary: $('analysis-summary'),
      resultsSection: $('results-section'),
      copyCards: $('copy-cards'),
      btnCopyAll: $('btn-copy-all'),
      btnRegenerate: $('btn-regenerate'),
      // 传统方式
      btnDownload: $('btn-download-txt'),
      btnCopy: $('btn-copy-text'),
      previewBox: $('preview-box')
    };
  }

  // ===== 图片选择 =====
  function initPhotoInput() {
    if (!els.photoInput || !els.previews) return;

    els.photoInput.addEventListener('change', function(e) {
      var files = Array.from(e.target.files || []);
      if (!files.length) return;

      files.forEach(function(file) {
        if (!file.type.match(/image\/(jpeg|png|heic|heif|webp)/i)) {
          if (file.type || file.size > 0) {
            showToast('⚠️ 请选择图片文件（JPG/PNG/HEIC）');
          }
          return;
        }
        if (state.selectedImages.length >= 5) {
          showToast('⚠️ 最多选择5张图片');
          return;
        }
        var reader = new FileReader();
        reader.onload = function(ev) {
          state.selectedImages.push({
            name: file.name,
            dataUrl: ev.target.result,
            size: file.size
          });
          renderPreviews();
        };
        reader.readAsDataURL(file);
      });
      // Reset input so same file can be re-selected
      els.photoInput.value = '';
    });

    renderPreviews();
  }

  function renderPreviews() {
    if (!els.previews) return;

    if (els.photoCount) {
      els.photoCount.textContent = state.selectedImages.length
        ? ' · ' + state.selectedImages.length + '张已选'
        : '';
    }

    if (!state.selectedImages.length) {
      els.previews.innerHTML = '';
      return;
    }

    var html = '';
    state.selectedImages.forEach(function(img, i) {
      html += '<div class="photo-thumb">' +
        '<img src="' + img.dataUrl + '" alt="' + (img.name || '图片' + (i+1)) + '">' +
        '<button class="photo-remove" data-idx="' + i + '" title="移除" type="button">✕</button>' +
        '<div class="photo-name">' + (img.name || '图片' + (i+1)) + '</div>' +
        '</div>';
    });
    els.previews.innerHTML = html;

    // Bind remove buttons
    els.previews.querySelectorAll('.photo-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        state.selectedImages.splice(idx, 1);
        renderPreviews();
      });
    });
  }

  // ===== 图片压缩 =====
  function compressImage(dataUrl, maxWidth, quality) {
    maxWidth = maxWidth || 1024;
    quality = quality || 0.8;
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var width = img.width;
        var height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * maxWidth / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function() {
        resolve(dataUrl); // fallback: return original
      };
      img.src = dataUrl;
    });
  }

  // ===== 状态切换 =====
  function setPhase(phase, msg) {
    state.phase = phase;
    state.errorMsg = msg || '';

    // Hide all state sections
    [els.stateUploading, els.stateAnalyzing, els.stateError,
     els.analysisSummary, els.resultsSection].forEach(function(el) {
      if (el) el.classList.add('hidden');
    });

    var btnText = els.btnGenerate ? els.btnGenerate.querySelector('.btn-generate-text') : null;

    switch (phase) {
      case 'idle':
        if (btnText) btnText.textContent = state.result ? '🔄 重新生成文案' : 'AI 一键生成文案';
        if (els.btnGenerate) els.btnGenerate.disabled = false;
        break;
      case 'uploading':
        if (els.stateUploading) els.stateUploading.classList.remove('hidden');
        if (btnText) btnText.textContent = '⏳ 处理中...';
        if (els.btnGenerate) els.btnGenerate.disabled = true;
        break;
      case 'analyzing':
        if (els.stateAnalyzing) els.stateAnalyzing.classList.remove('hidden');
        if (btnText) btnText.textContent = '⏳ AI分析中...';
        if (els.btnGenerate) els.btnGenerate.disabled = true;
        break;
      case 'results':
        if (els.analysisSummary) els.analysisSummary.classList.remove('hidden');
        if (els.resultsSection) els.resultsSection.classList.remove('hidden');
        if (btnText) btnText.textContent = '🔄 重新生成文案';
        if (els.btnGenerate) els.btnGenerate.disabled = false;
        // Scroll to results
        if (els.resultsSection) {
          els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        break;
      case 'error':
        if (els.stateError) els.stateError.classList.remove('hidden');
        if (els.errorText) els.errorText.textContent = state.errorMsg;
        if (btnText) btnText.textContent = '🔄 重试';
        if (els.btnGenerate) els.btnGenerate.disabled = false;
        break;
    }
  }

  // ===== 调用 API（自动适配本地/远程） =====
  async function callWorkerAPI() {
    var workerUrl = els.form ? els.form.dataset.workerUrl : '';

    // 如果当前页面是 HTTPS (GitHub Pages)，但 API 是 HTTP，会被浏览器拦截
    // 提示用户打开本地地址
    if (window.location.protocol === 'https:' && workerUrl && workerUrl.startsWith('http:')) {
      var localPath = window.location.pathname;
      throw new Error(
        '请在手机浏览器打开本地地址：\\n' + workerUrl + localPath + '\\n\\n' +
        '（确保手机和电脑连接同一WiFi）'
      );
    }

    // 本地 HTTP 服务器上运行时，使用同源地址
    if (window.location.protocol === 'http:') {
      workerUrl = window.location.origin;
    }

    if (!workerUrl || workerUrl === '__WORKER_URL__') {
      throw new Error('AI 服务未配置，请先部署 API 服务器');
    }

    var storeId = els.form ? els.form.dataset.storeId : '';
    var storeName = els.form ? els.form.dataset.storeName : '';
    var storeBrands = els.form ? els.form.dataset.storeBrands : '';

    // 压缩图片
    setPhase('uploading');
    var compressedImages = [];
    for (var i = 0; i < state.selectedImages.length; i++) {
      var compressed = await compressImage(state.selectedImages[i].dataUrl, 1024, 0.8);
      compressedImages.push(compressed);
    }

    // 收集表单数据
    setPhase('analyzing');
    var productInfo = {
      name: getVal('prod-name'),
      brand: getVal('prod-brand'),
      notes: getVal('prod-notes')
    };

    // 调用 Worker
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 45000); // 45s timeout

    try {
      var response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: compressedImages,
          storeId: storeId,
          storeName: storeName,
          brands: storeBrands,
          productInfo: productInfo
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        var errData;
        try {
          errData = await response.json();
        } catch (e) {
          errData = { error: 'HTTP ' + response.status };
        }
        throw new Error(errData.error || '请求失败 (' + response.status + ')');
      }

      return await response.json();
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        throw new Error('请求超时（45秒），请检查网络后重试');
      }
      throw e;
    }
  }

  function getVal(id) {
    var el = $(id);
    return el ? el.value.trim() : '';
  }

  // ===== 渲染分析结果 =====
  function renderAnalysis(analysis) {
    if (!els.analysisSummary) return;

    var items = [];
    if (analysis.brand_recognition && analysis.brand_recognition !== '未识别') {
      items.push({ label: '🏷️ 品牌', value: analysis.brand_recognition });
    }
    if (analysis.style_category) {
      items.push({ label: '👔 风格', value: analysis.style_category });
    }
    if (analysis.product_category) {
      items.push({ label: '📦 品类', value: analysis.product_category });
    }
    if (analysis.color_scheme) {
      items.push({ label: '🎨 配色', value: analysis.color_scheme });
    }
    if (analysis.fabric_texture) {
      items.push({ label: '🧵 面料', value: analysis.fabric_texture });
    }

    var html = '<div style="font-size:.78em;color:var(--muted);margin-bottom:4px">🔍 AI 识别结果</div><div class="analysis-tags">';
    items.forEach(function(item) {
      html += '<span class="analysis-tag"><strong>' + item.label + '</strong> ' + item.value + '</span>';
    });
    if (analysis.key_selling_points && analysis.key_selling_points.length) {
      html += '<span class="analysis-tag analysis-tag-sell">💎 ' + analysis.key_selling_points.join(' · ') + '</span>';
    }
    html += '</div>';
    els.analysisSummary.innerHTML = html;
  }

  // ===== 渲染文案卡片 =====
  function renderCopies(copies) {
    if (!els.copyCards) return;

    var typeColors = ['copy-type-0', 'copy-type-1', 'copy-type-2'];

    var html = '';
    copies.forEach(function(copy, i) {
      var tagsHtml = '';
      if (copy.tags && copy.tags.length) {
        tagsHtml = copy.tags.map(function(t) {
          return '<span class="tag tag-s">' + t + '</span>';
        }).join(' ');
      }

      var hookHtml = '';
      if (copy.hook) {
        hookHtml = '<div class="copy-hook">🎬 开头话术：' + copy.hook + '</div>';
      }

      html += '<div class="copy-card">' +
        '<div class="copy-card-header">' +
        '<span class="copy-type-badge ' + (typeColors[i] || '') + '">' + copy.type + '</span>' +
        '<button class="copy-btn-icon" data-idx="' + i + '" title="复制此版文案" type="button">📋 复制</button>' +
        '</div>' +
        '<h4 class="copy-title">' + (copy.title || '') + '</h4>' +
        hookHtml +
        '<div class="copy-body">' + (copy.body || '') + '</div>' +
        '<div class="copy-tags">' + tagsHtml + '</div>' +
        '</div>';
    });
    els.copyCards.innerHTML = html;

    // 绑定复制按钮
    els.copyCards.querySelectorAll('.copy-btn-icon').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        var copy = copies[idx];
        if (!copy) return;
        var text = (copy.title || '') + '\n\n' +
          (copy.hook ? '🎬 开头：' + copy.hook + '\n\n' : '') +
          (copy.body || '') + '\n\n' +
          (copy.tags ? copy.tags.join(' ') : '');
        copyToClipboard(text, '✅ 已复制「' + copy.type + '」文案');
      });
    });
  }

  // ===== 一键复制全部 =====
  function initCopyAll() {
    if (!els.btnCopyAll) return;
    els.btnCopyAll.addEventListener('click', function() {
      if (!state.result || !state.result.copies) return;

      var allText = '';
      state.result.copies.forEach(function(copy, i) {
        allText += '━━━ ' + copy.type + ' ━━━\n';
        allText += (copy.title || '') + '\n\n';
        if (copy.hook) allText += '🎬 开头：' + copy.hook + '\n\n';
        allText += (copy.body || '') + '\n';
        if (copy.tags && copy.tags.length) {
          allText += copy.tags.join(' ') + '\n';
        }
        if (i < state.result.copies.length - 1) allText += '\n';
      });
      copyToClipboard(allText, '✅ 已复制全部3版文案');
    });
  }

  // ===== 重新生成 =====
  function initRegenerate() {
    if (!els.btnRegenerate) return;
    els.btnRegenerate.addEventListener('click', function() {
      handleGenerate();
    });
  }

  // ===== 主操作 =====
  async function handleGenerate() {
    if (state.selectedImages.length === 0) {
      showToast('⚠️ 请先选择产品搭配图');
      return;
    }

    try {
      var data = await callWorkerAPI();
      state.result = data;

      // 渲染结果
      if (data.analysis) {
        renderAnalysis(data.analysis);
      }
      if (data.copies && data.copies.length) {
        renderCopies(data.copies);
      }
      setPhase('results');
      showToast('✅ 文案生成完成');
    } catch (e) {
      console.error('Generate error:', e);
      setPhase('error', e.message || '未知错误');
    }
  }

  function initGenerateButton() {
    if (!els.btnGenerate) return;
    els.btnGenerate.addEventListener('click', function() {
      handleGenerate();
    });
  }

  // 重试按钮
  function initRetry() {
    if (!els.btnRetry) return;
    els.btnRetry.addEventListener('click', function() {
      handleGenerate();
    });
  }

  // ===== 剪贴板 =====
  async function copyToClipboard(text, toastMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(toastMsg || '✅ 已复制');
    } catch (err) {
      // 回退方案
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(toastMsg || '✅ 已复制');
      } catch (e2) {
        showToast('⚠️ 复制失败，请长按文字手动复制');
      }
      document.body.removeChild(ta);
    }
  }

  // ===== 传统下载功能（保留） =====
  function initLegacyFeatures() {
    // 下载 .txt 文件
    if (els.btnDownload) {
      els.btnDownload.addEventListener('click', function() {
        var text = buildLegacyText(false);
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var storeId = els.form ? els.form.dataset.storeId : 'store';
        var dateStr = new Date().toISOString().slice(0, 10);
        a.download = '产品生成请求_' + storeId + '_' + dateStr + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ 产品说明文件已下载，请保存到上传文件夹');
      });
    }

    // 复制文本（不含 base64 图片）
    if (els.btnCopy) {
      els.btnCopy.addEventListener('click', async function() {
        var text = buildLegacyText(true);
        copyToClipboard(text, '✅ 已复制，请粘贴到上传文件夹的"产品说明.txt"');
      });
    }
  }

  function buildLegacyText(textOnly) {
    var storeName = els.form ? els.form.dataset.storeName : '';
    var storeBrands = els.form ? els.form.dataset.storeBrands : '';
    var now = new Date();
    var dateStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    var text = '📥 产品文案生成请求\n' +
      '==================\n' +
      '门店：' + storeName + '\n' +
      '日期：' + dateStr + '\n' +
      '------------------\n' +
      '产品名称：' + (getVal('prod-name') || '未填写') + '\n' +
      '品牌：' + (getVal('prod-brand') || '未选择') + '\n' +
      '补充说明：' + (getVal('prod-notes') || '') + '\n' +
      '门店品牌：' + storeBrands + '\n';

    if (state.selectedImages.length) {
      text += '------------------\n' +
        '已选图片：' + state.selectedImages.length + '张\n';
      state.selectedImages.forEach(function(img, i) {
        text += '  ' + (i+1) + '. ' + img.name + '\n';
      });

      if (!textOnly) {
        text += '\n===== 图片Base64（共' + state.selectedImages.length + '张）=====\n';
        state.selectedImages.forEach(function(img, i) {
          text += '\n--- 图片' + (i+1) + ': ' + img.name + ' ---\n';
          text += img.dataUrl + '\n';
        });
      }
    }

    text += '------------------\n' +
      '📌 请基于以上信息生成：\n' +
      '  1. 品牌故事型文案\n' +
      '  2. 场景痛点解决型文案\n' +
      '  3. 情感共鸣型文案\n' +
      '  附带拍摄脚本、推荐标签、本地化建议\n';

    return text;
  }

  // ===== Toast 提示 =====
  function showToast(msg) {
    var toast = $('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function() {
      toast.classList.remove('show');
    }, 3000);
  }

  // ===== 选题「一键生成口播文案」按钮 =====
  function initTopicGenButtons() {
    document.querySelectorAll('.btn-topic-gen').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topic = this.dataset.topic || '';
        var angle = this.dataset.angle || '';
        var ctype = this.dataset.ctype || '';

        // 滚动到上传区域
        var uploadZone = document.getElementById('upload-zone');
        if (uploadZone) {
          uploadZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // 预填补充说明为选题角度
        var notesEl = document.getElementById('prod-notes');
        if (notesEl) {
          var hint = '选题：' + topic + '\n类型：' + ctype + '\n参考角度：' + angle;
          if (notesEl.value && notesEl.value.trim()) {
            notesEl.value = notesEl.value.trim() + '\n\n' + hint;
          } else {
            notesEl.value = hint;
          }
        }

        // 提示用户上传图片
        showToast('📸 请上传产品搭配图（可选），然后点击「AI生成」');

        // 延迟聚焦图片上传
        setTimeout(function() {
          var photoLabel = document.querySelector('.photo-upload-label');
          if (photoLabel) {
            photoLabel.style.animation = 'pulse 0.6s ease 3';
            setTimeout(function() { photoLabel.style.animation = ''; }, 1800);
          }
        }, 500);
      });
    });
  }

  // ===== 初始化 =====
  function init() {
    cacheElements();
    if (!els.form) return; // 不在门店页面

    initPhotoInput();
    initGenerateButton();
    initRetry();
    initCopyAll();
    initRegenerate();
    initLegacyFeatures();
    initTopicGenButtons();

    // 初始状态
    setPhase('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
