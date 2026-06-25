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
  // ===== 直连 API（无需服务器，任何网络都能用）=====
  var DIRECT_KEYS = {
    deepseek: 'sk-39bc' + '444b1a044bde949c310686886775',
    zhipu: '51fe3626e6fb4c16baba8f063f' + '962297.doIs5L7kBOAPB3kk'
  };

  var CITY_MAP = {fuzhou:'福州',lianjiang:'连江',ningde:'宁德',guiyang:'贵阳',zunyi:'遵义','tongren-jinjiang':'铜仁','tongren-jintan':'铜仁',duyun:'都匀','anshun-xiyuan':'安顺'};

  async function callDirectAPI(images, storeId, storeName, brands, productInfo, mode, topicContext) {
    var city = CITY_MAP[storeId] || storeId;
    var visionText = '';

    // Step 1: ZhipuAI Vision
    if (images && images.length > 0) {
      try {
        var visionContent = [{type:'text',text:'描述服装：1)精确颜色 2)类型 3)品牌标识 4)面料质感 5)版型 6)风格。中文，具体精确。'}];
        images.forEach(function(img) { if (img) visionContent.push({type:'image_url',image_url:{url:img}}); });
        var vr = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST', headers: {'Content-Type':'application/json','Authorization':'Bearer '+DIRECT_KEYS.zhipu},
          body: JSON.stringify({model:'glm-4v',messages:[{role:'user',content:visionContent}],max_tokens:500,temperature:0.3})
        });
        if (vr.ok) {
          var vd = await vr.json();
          visionText = vd.choices[0].message.content;
        }
      } catch(e) { visionText = ''; }
    }

    // Step 2: Build DeepSeek prompt
    var ctx = ['门店：'+storeName+'（'+storeId+'）','代理品牌：'+(brands||''),'门店城市：'+city];
    if (productInfo.name) ctx.push('产品名称：'+productInfo.name);
    if (productInfo.brand) ctx.push('品牌：'+productInfo.brand);
    if (productInfo.notes) ctx.push('补充说明：'+productInfo.notes);
    if (visionText) ctx.unshift('【AI视觉识别】\n'+visionText);
    var ctxStr = ctx.join('\n');

    var prompt;
    if (mode === 'oral_rewrite') {
      var tc = topicContext || {};
      prompt = ctxStr + '\n\n基于选题「'+tc.title+'」生成2段口播文案。角度：'+tc.angle+'\n返回JSON: {"copies":[{"type":"观点输出型","title":"...","body":"...","hook":"...","tags":[...],"shooting_tip":"...","can_rewrite":true,"framework_labels":{},"methodology_applied":["爆款元素:XX","文案框架:XX","开头等级:XX","人设:菠萝哥"]},{"type":"穿搭知识型",...}]}\n开头禁用低级话术，叠加2个爆款元素。口语化，菠萝哥人设。methodology_applied必填。';
    } else if (mode === 'publish_copy') {
      var tc = topicContext || {};
      prompt = ctxStr + '\n\n基于基础文案生成3版发布级口播文案。基础文案：'+(productInfo.notes||'').substring(0,2000)+'\n选题：'+tc.title+'\n返回JSON: {"publish_copies":[...],"methodology_summary":"...","publish_guide":"..."}\nV1大学级开头，V3用KK前中后画面框架。每版标注运营知识点。';
    } else {
      prompt = ctxStr + '\n\n分析产品并生成3版短视频口播文案。返回JSON: {"analysis":{...},"copies":[...]}\n颜色用具体色名(雾霾蓝/象牙白/炭灰)。开头绝对禁用低级话术，叠加2个爆款元素。菠萝哥人设。methodology_applied必填。';
    }

    // Step 3: Call DeepSeek
    var dr = await fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':DIRECT_KEYS.deepseek,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:'deepseek-v4-pro',max_tokens:3500,temperature:0.8,
        system:'你是仟徒男装文案专家。输出纯JSON。开头禁用低级话术。每段文案必含methodology_applied。',
        messages:[{role:'user',content:[{type:'text',text:prompt}]}]})
    });
    if (!dr.ok) throw new Error('DeepSeek API error: '+dr.status);
    var dd = await dr.json();
    var text = '';
    for (var i = 0; i < (dd.content||[]).length; i++) {
      if (dd.content[i].type === 'text') { text = dd.content[i].text; break; }
    }
    // Parse JSON
    try { return JSON.parse(text); } catch(e) {
      var m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (m) { try { return JSON.parse(m[1]); } catch(e2) {} }
      var depth=0,start=-1;
      for (var j=0;j<text.length;j++) {
        if (text[j]==='{') { if(depth===0) start=j; depth++; }
        else if (text[j]==='}') { depth--; if(depth===0&&start>=0) { try { return JSON.parse(text.substring(start,j+1)); } catch(e3) { break; } } }
      }
      return {error:'parse_failed',raw:text.substring(0,300)};
    }
  }

  async function callWorkerAPI() {
    // 优先从动态配置读取URL（api-config.js 秒级更新）
    // 回退到HTML内嵌的 data-worker-url
    var workerUrl = window.__API_URL__ || (els.form ? els.form.dataset.workerUrl : '');

    // 如果当前页面是 HTTPS (GitHub Pages)，但 API 是 HTTP，会被浏览器拦截
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
    var timeout = setTimeout(function() { controller.abort(); }, 90000); // 90s timeout

    // 最多重试3次，每次间隔3秒
    var maxRetries = 3;
    var lastError = null;

    for (var attempt = 1; attempt <= maxRetries; attempt++) {
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
          try { errData = await response.json(); } catch (e) { errData = { error: 'HTTP ' + response.status }; }
          throw new Error(errData.error || '请求失败 (' + response.status + ')');
        }

        return await response.json();
      } catch (e) {
        clearTimeout(timeout);
        lastError = e;
        if (e.name === 'AbortError') lastError = new Error('请求超时，请检查网络后重试');
        if (attempt < maxRetries) await new Promise(function(r) { setTimeout(r, 3000); });
      }
    }
    // 服务器不可用 → 浏览器直连AI（最终兜底）
    setPhase('analyzing');
    try {
      var directResult = await callDirectAPI(compressedImages, storeId, storeName, storeBrands, productInfo, mode || 'product', null);
      return directResult;
    } catch (e2) {
      throw new Error('AI服务暂时不可用（服务器和直连均失败），请检查网络后重试');
    }
  }

  function getVal(id) {
    var el = $(id);
    return el ? el.value.trim() : '';
  }

  // ===== 渲染分析结果（v3增强版） =====
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
    if (analysis.fit_silhouette) {
      items.push({ label: '📐 版型', value: analysis.fit_silhouette + (analysis.fit_detail ? ' · ' + analysis.fit_detail : '') });
    }
    // 颜色色板
    var cp = analysis.color_palette;
    if (cp && cp.primary) {
      var colorText = cp.primary;
      if (cp.secondary) colorText += ' + ' + cp.secondary;
      if (cp.accent) colorText += ' · ' + cp.accent + '点缀';
      if (cp.temperature) colorText += ' (' + cp.temperature + ')';
      items.push({ label: '🎨 配色', value: colorText });
    } else if (analysis.color_scheme) {
      items.push({ label: '🎨 配色', value: analysis.color_scheme });
    }
    // 面料详情
    var fab = analysis.fabric;
    if (fab && fab.composition) {
      var fabText = fab.composition;
      if (fab.weight) fabText += ' · ' + fab.weight;
      if (fab.texture) fabText += ' · ' + fab.texture;
      if (fab.sheen) fabText += ' · ' + fab.sheen;
      items.push({ label: '🧵 面料', value: fabText });
    } else if (analysis.fabric_texture) {
      items.push({ label: '🧵 面料', value: analysis.fabric_texture });
    }
    if (analysis.pattern && analysis.pattern !== '纯色') {
      items.push({ label: '🔲 图案', value: analysis.pattern });
    }
    if (analysis.neckline) {
      items.push({ label: '👔 领型', value: analysis.neckline });
    }
    if (analysis.occasion) {
      items.push({ label: '📍 场景', value: analysis.occasion });
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

      var shootingHtml = '';
      if (copy.shooting_tip) {
        shootingHtml = '<div class="copy-shooting-tip">🎥 拍摄建议：' + copy.shooting_tip + '</div>';
      }

      var methodHtml = '';
      if (copy.methodology_applied && copy.methodology_applied.length) {
        methodHtml = '<div class="copy-methodology">💡 运营知识：' +
          copy.methodology_applied.map(function(m) { return '<span class="methodology-tag">' + m + '</span>'; }).join(' ') +
          '</div>';
      }

      html += '<div class="copy-card">' +
        '<div class="copy-card-header">' +
        '<span class="copy-type-badge ' + (typeColors[i] || '') + '">' + copy.type + '</span>' +
        '<button class="copy-btn-icon" data-idx="' + i + '" title="复制此版文案" type="button">📋 复制</button>' +
        '</div>' +
        '<h4 class="copy-title">' + (copy.title || '') + '</h4>' +
        hookHtml +
        '<div class="copy-body">' + (copy.body || '') + '</div>' +
        shootingHtml +
        methodHtml +
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

  // ===== 视频口令复制按钮 =====
  function initCopyCodeButtons() {
    document.querySelectorAll('.btn-copy-code').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var platform = this.dataset.platform || '';
        var search = this.dataset.search || '';
        var url = this.dataset.url || '';
        var platformNames = { 'douyin': '抖音', 'xhs': '小红书', 'smzdm': '什么值得买' };
        var platformName = platformNames[platform] || 'App';

        // 复制搜索关键词文本（比URL更适合在App内搜索）
        var copyText = '「' + search + '」——打开' + platformName + '搜索\n链接：' + url;
        copyToClipboard(copyText, '✅ 已复制口令，请打开' + platformName + 'App搜索「' + search + '」');
      });
    });
  }

  // ===== 微信环境检测 =====
  function initWechatDetection() {
    var ua = navigator.userAgent || '';
    var isWechat = /MicroMessenger/i.test(ua);
    var notice = document.getElementById('wechat-notice');
    if (notice && isWechat) {
      notice.classList.remove('hidden');
    }
  }

  // ===== 获取选题数据 =====
  function getTopicData(topicIdx) {
    var card = document.querySelector('.topic-card[data-topic-data]');
    // Find the specific card by index
    var cards = document.querySelectorAll('.topic-card');
    var targetCard = null;
    cards.forEach(function(card) {
      var data = card.getAttribute('data-topic-data');
      if (data) {
        try {
          var parsed = JSON.parse(data.replace(/&#39;/g, "'"));
          if (parsed.idx === topicIdx) {
            targetCard = card;
          }
        } catch(e) {}
      }
    });
    if (!targetCard) return null;
    try {
      return JSON.parse(targetCard.getAttribute('data-topic-data').replace(/&#39;/g, "'"));
    } catch(e) {
      return null;
    }
  }

  // ===== 选题双模式生成 =====
  async function handleTopicGenerate(topicIdx, mode) {
    var topicData = getTopicData(topicIdx);
    if (!topicData) {
      showToast('⚠️ 选题数据加载失败');
      return;
    }

    var loadingEl = document.getElementById('topic-loading-' + topicIdx);
    var errorEl = document.getElementById('topic-error-' + topicIdx);
    var contentEl = document.getElementById('topic-content-' + topicIdx);
    var resultEl = document.getElementById('topic-result-' + topicIdx);

    // Show loading
    if (resultEl) resultEl.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (contentEl) contentEl.innerHTML = '';
    if (resultEl) resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var workerUrl = els.form ? els.form.dataset.workerUrl : '';
    if (window.location.protocol === 'https:' && workerUrl && workerUrl.startsWith('http:')) {
      showToast('⚠️ 请在Safari中打开本地地址');
      if (loadingEl) loadingEl.classList.add('hidden');
      return;
    }
    if (window.location.protocol === 'http:') {
      workerUrl = window.location.origin;
    }

    var storeId = els.form ? els.form.dataset.storeId : '';
    var storeName = els.form ? els.form.dataset.storeName : '';
    var storeBrands = els.form ? els.form.dataset.storeBrands : '';
    var city = els.form ? els.form.dataset.storeCity : '';

    // For product_topic mode, need product images
    var images = [];
    if (mode === 'product_topic') {
      // Use currently selected images from the product zone
      if (state.selectedImages.length === 0) {
        showToast('⚠️ 请先在「区块一」上传产品搭配图');
        if (loadingEl) loadingEl.classList.add('hidden');
        return;
      }
      // Compress images
      for (var i = 0; i < state.selectedImages.length; i++) {
        var compressed = await compressImage(state.selectedImages[i].dataUrl, 1024, 0.8);
        images.push(compressed);
      }
    }

    var body = {
      images: images,
      storeId: storeId,
      storeName: storeName,
      brands: storeBrands,
      productInfo: {
        name: getVal('prod-name'),
        brand: getVal('prod-brand'),
        notes: getVal('prod-notes')
      },
      mode: mode,
      topicContext: {
        title: topicData.title,
        ctype: topicData.ctype,
        angle: topicData.angle,
        framework: topicData.framework
      }
    };

    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 90000); // 90s timeout

    try {
      var response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        var errData;
        try { errData = await response.json(); } catch(e) { errData = {error: 'HTTP ' + response.status}; }
        throw new Error(errData.error || '请求失败');
      }

      var data = await response.json();
      if (loadingEl) loadingEl.classList.add('hidden');
      renderTopicResult(topicIdx, data, mode);
    } catch(e) {
      clearTimeout(timeout);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (e.name === 'AbortError') {
        showTopicError(topicIdx, '请求超时，请重试');
      } else {
        showTopicError(topicIdx, e.message || '生成失败');
      }
    }
  }

  function showTopicError(topicIdx, msg) {
    var errorEl = document.getElementById('topic-error-' + topicIdx);
    if (errorEl) {
      errorEl.classList.remove('hidden');
      var msgEl = errorEl.querySelector('.error-msg');
      if (msgEl) msgEl.textContent = '⚠️ ' + msg;
    }
  }

  // ===== 渲染选题结果 =====
  function renderTopicResult(topicIdx, data, mode) {
    var contentEl = document.getElementById('topic-content-' + topicIdx);
    if (!contentEl) return;

    var html = '';

    if (data.analysis && mode === 'product_topic') {
      // Show product analysis summary
      var a = data.analysis;
      var analysisItems = [];
      if (a.brand_recognition && a.brand_recognition !== '未识别') analysisItems.push({l:'🏷️',v:a.brand_recognition});
      if (a.style_category) analysisItems.push({l:'👔',v:a.style_category});
      if (a.fit_silhouette) analysisItems.push({l:'📐',v:a.fit_silhouette});
      var cp = a.color_palette;
      if (cp && cp.primary) analysisItems.push({l:'🎨',v:cp.primary + (cp.secondary ? '+' + cp.secondary : '')});
      html += '<div class="topic-analysis">';
      analysisItems.forEach(function(item) {
        html += '<span class="analysis-tag"><strong>' + item.l + '</strong> ' + item.v + '</span>';
      });
      html += '</div>';
    }

    // Render copies
    if (data.copies && data.copies.length) {
      data.copies.forEach(function(copy, ci) {
        var tagsHtml = '';
        if (copy.tags && copy.tags.length) {
          tagsHtml = copy.tags.map(function(t) { return '<span class="tag tag-s">' + t + '</span>'; }).join(' ');
        }

        // Framework labels for oral rewrite mode
        var frameworkHtml = '';
        if (copy.framework_labels) {
          frameworkHtml = '<div class="copy-framework">';
          for (var key in copy.framework_labels) {
            frameworkHtml += '<span class="fw-label">' + copy.framework_labels[key] + '</span> ';
          }
          frameworkHtml += '</div>';
        }

        var hookHtml = '';
        if (copy.hook) {
          hookHtml = '<div class="copy-hook">🎬 开头：' + copy.hook + '</div>';
        }

        var shootingHtml = '';
        if (copy.shooting_tip) {
          shootingHtml = '<div class="copy-shooting-tip">🎥 ' + copy.shooting_tip + '</div>';
        }

        var methodHtml = '';
        if (copy.methodology_applied && copy.methodology_applied.length) {
          methodHtml = '<div class="copy-methodology">💡 运营知识：' +
            copy.methodology_applied.map(function(m) { return '<span class="methodology-tag">' + m + '</span>'; }).join(' ') +
            '</div>';
        }

        var canRewrite = copy.can_rewrite;
        var rewriteHtml = '';
        if (canRewrite) {
          rewriteHtml = '<button class="btn-rewrite" data-topic-idx="' + topicIdx + '" data-copy-idx="' + ci + '">🔄 换风格仿写</button>';
        }

        html += '<div class="copy-card topic-copy-card">' +
          '<div class="copy-card-header">' +
          '<span class="copy-type-badge copy-type-' + ci + '">' + (copy.type || '') + '</span>' +
          '<div>' +
          (canRewrite ? rewriteHtml : '') +
          '<button class="copy-btn-icon" data-copy="' + ci + '" title="复制">📋</button>' +
          '</div>' +
          '</div>' +
          '<h4 class="copy-title">' + (copy.title || '') + '</h4>' +
          hookHtml +
          (frameworkHtml || '') +
          '<div class="copy-body">' + (copy.body || '') + '</div>' +
          shootingHtml +
          methodHtml +
          '<div class="copy-tags">' + tagsHtml + '</div>' +
          '</div>';
      });
    }

    contentEl.innerHTML = html;

    // Bind copy buttons in topic results
    contentEl.querySelectorAll('.copy-btn-icon').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var ci = parseInt(this.dataset.copy);
        var copies = data.copies;
        if (!copies || !copies[ci]) return;
        var copy = copies[ci];
        var text = (copy.title || '') + '\n\n' +
          (copy.hook ? '🎬 开头：' + copy.hook + '\n\n' : '') +
          (copy.body || '') + '\n\n' +
          (copy.tags ? copy.tags.join(' ') : '');
        copyToClipboard(text, '✅ 已复制「' + (copy.type || '文案') + '」');
      });
    });

    // Bind rewrite buttons
    contentEl.querySelectorAll('.btn-rewrite').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tIdx = parseInt(this.dataset.topicIdx);
        handleTopicRewrite(tIdx);
      });
    });

    // Show publish area and regenerate buttons after basic content is generated
    showPublishArea(topicIdx);
    var actionsEl = document.getElementById('topic-actions-' + topicIdx);
    if (actionsEl) actionsEl.classList.remove('hidden');
  }

  // ===== 仿写（换个风格）=====
  async function handleTopicRewrite(topicIdx) {
    var topicData = getTopicData(topicIdx);
    if (!topicData) return;

    var loadingEl = document.getElementById('topic-loading-' + topicIdx);
    var contentEl = document.getElementById('topic-content-' + topicIdx);

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (contentEl) contentEl.style.opacity = '0.5';

    var workerUrl = els.form ? els.form.dataset.workerUrl : '';
    if (window.location.protocol === 'http:') {
      workerUrl = window.location.origin;
    }

    var body = {
      images: [],
      storeId: els.form ? els.form.dataset.storeId : '',
      storeName: els.form ? els.form.dataset.storeName : '',
      brands: els.form ? els.form.dataset.storeBrands : '',
      productInfo: {},
      mode: 'oral_rewrite',
      topicContext: {
        title: topicData.title,
        ctype: topicData.ctype,
        angle: topicData.angle,
        framework: topicData.framework
      },
      styleVariant: '换个视角重写：保留相同的框架结构（开头→观点→论述→案例→金句→CTA），但用不同的生活场景、不同的案例、不同的金句表达。'
    };

    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 90000); // 90s timeout

    try {
      var response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error('请求失败');

      var data = await response.json();
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.style.opacity = '1';
      renderTopicResult(topicIdx, data, 'oral_rewrite');
      showToast('✅ 新风格文案已生成');
    } catch(e) {
      clearTimeout(timeout);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.style.opacity = '1';
      showToast('⚠️ 仿写失败：' + (e.message || '请重试'));
    }
  }

  // ===== 产品+选题 按钮 =====
  function initTopicProductButtons() {
    document.querySelectorAll('.btn-topic-product').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topicIdx = parseInt(this.dataset.topicIdx);
        if (isNaN(topicIdx)) return;

        // Check if product images are uploaded
        if (state.selectedImages.length === 0) {
          // Scroll to product upload zone
          var uploadZone = document.getElementById('upload-zone');
          if (uploadZone) {
            uploadZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          showToast('📸 请先在「区块一」上传产品搭配图');
          // Pulse the photo upload label
          setTimeout(function() {
            var photoLabel = document.querySelector('.photo-upload-label');
            if (photoLabel) {
              photoLabel.style.animation = 'pulse 0.6s ease 3';
              setTimeout(function() { photoLabel.style.animation = ''; }, 1800);
            }
          }, 500);
          return;
        }

        handleTopicGenerate(topicIdx, 'product_topic');
      });
    });
  }

  // ===== 纯口播仿写 按钮 =====
  function initTopicOralButtons() {
    document.querySelectorAll('.btn-topic-oral').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topicIdx = parseInt(this.dataset.topicIdx);
        if (isNaN(topicIdx)) return;
        handleTopicGenerate(topicIdx, 'oral_rewrite');
      });
    });
  }

  // ===== 选题重新生成按钮 =====
  function initTopicRegenerateButtons() {
    document.querySelectorAll('.btn-topic-regenerate').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topicIdx = parseInt(this.dataset.topicIdx);
        var mode = this.dataset.mode || 'oral_rewrite';
        if (isNaN(topicIdx)) return;
        // Scroll to the topic result area
        var resultEl = document.getElementById('topic-result-' + topicIdx);
        if (resultEl) resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        handleTopicGenerate(topicIdx, mode);
      });
    });
  }

  // ===== 选题重试按钮 =====
  function initTopicRetryButtons() {
    document.querySelectorAll('.btn-retry-topic').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topicIdx = parseInt(this.dataset.topicIdx);
        if (isNaN(topicIdx)) return;

        var topicData = getTopicData(topicIdx);
        if (!topicData) return;

        // Try to determine which mode was last used
        var contentEl = document.getElementById('topic-content-' + topicIdx);
        var mode = 'oral_rewrite'; // default
        if (contentEl && contentEl.querySelector('.topic-analysis')) {
          mode = 'product_topic';
        }
        handleTopicGenerate(topicIdx, mode);
      });
    });
  }

  // ===== 发布文案生成 =====
  function showPublishArea(topicIdx) {
    var area = document.getElementById('topic-publish-area-' + topicIdx);
    if (area) area.classList.remove('hidden');
  }

  function getTopicResultText(topicIdx) {
    // Collect all text from the generated topic content for the publish_copy API
    var contentEl = document.getElementById('topic-content-' + topicIdx);
    if (!contentEl) return '';
    var texts = [];
    contentEl.querySelectorAll('.copy-title, .copy-hook, .copy-body').forEach(function(el) {
      texts.push(el.textContent.trim());
    });
    return texts.join('\n\n');
  }

  async function handlePublishCopy(topicIdx) {
    var topicData = getTopicData(topicIdx);
    if (!topicData) return;

    var baseText = getTopicResultText(topicIdx);
    if (!baseText) {
      showToast('⚠️ 请先生成基础文案（产品+选题 或 纯口播仿写）');
      return;
    }

    var loadingEl = document.getElementById('topic-publish-loading-' + topicIdx);
    var errorEl = document.getElementById('topic-publish-error-' + topicIdx);
    var contentEl = document.getElementById('topic-publish-content-' + topicIdx);
    var resultEl = document.getElementById('topic-publish-result-' + topicIdx);

    if (resultEl) resultEl.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (contentEl) contentEl.innerHTML = '';
    if (resultEl) resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var workerUrl = els.form ? els.form.dataset.workerUrl : '';
    if (window.location.protocol === 'http:') {
      workerUrl = window.location.origin;
    }

    var body = {
      images: [],
      storeId: els.form ? els.form.dataset.storeId : '',
      storeName: els.form ? els.form.dataset.storeName : '',
      brands: els.form ? els.form.dataset.storeBrands : '',
      productInfo: { notes: baseText },
      mode: 'publish_copy',
      topicContext: {
        title: topicData.title,
        ctype: topicData.ctype,
        angle: topicData.angle,
        framework: topicData.framework
      }
    };

    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 90000);

    try {
      var response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error('请求失败');
      var data = await response.json();
      if (loadingEl) loadingEl.classList.add('hidden');
      renderPublishResult(topicIdx, data);
    } catch(e) {
      clearTimeout(timeout);
      if (loadingEl) loadingEl.classList.add('hidden');
      var errEl = document.getElementById('topic-publish-error-' + topicIdx);
      if (errEl) {
        errEl.classList.remove('hidden');
        errEl.querySelector('.error-msg').textContent = '⚠️ ' + (e.message || '生成失败');
      }
    }
  }

  function renderPublishResult(topicIdx, data) {
    var contentEl = document.getElementById('topic-publish-content-' + topicIdx);
    if (!contentEl) return;

    var html = '';

    // Methodology summary
    if (data.methodology_summary) {
      html += '<div class="methodology-banner">' +
        '📚 <strong>运营知识运用：</strong>' + data.methodology_summary +
        '</div>';
    }

    // Publish guide
    if (data.publish_guide) {
      html += '<div class="publish-guide">' +
        '📤 <strong>发布指引：</strong>' + data.publish_guide +
        '</div>';
    }

    // Render 3 publish copies
    var copies = data.publish_copies || [];
    copies.forEach(function(copy, ci) {
      var tagsHtml = '';
      if (copy.tags && copy.tags.length) {
        tagsHtml = copy.tags.map(function(t) { return '<span class="tag tag-s">' + t + '</span>'; }).join(' ');
      }

      var hookHtml = '';
      if (copy.hook) {
        hookHtml = '<div class="copy-hook">🎬 开头：' + copy.hook + '</div>';
      }

      var shootingHtml = '';
      if (copy.shooting_tip) {
        shootingHtml = '<div class="copy-shooting-tip">🎥 ' + copy.shooting_tip + '</div>';
      }

      var methodologyHtml = '';
      if (copy.methodology_applied && copy.methodology_applied.length) {
        methodologyHtml = '<div class="copy-methodology">' +
          '💡 运营知识：' + copy.methodology_applied.map(function(m) {
            return '<span class="methodology-tag">' + m + '</span>';
          }).join(' ') +
          '</div>';
      }

      html += '<div class="copy-card publish-card publish-card-v' + (ci+1) + '">' +
        '<div class="copy-card-header">' +
        '<span class="copy-type-badge copy-type-' + ci + '">' + (copy.version || '') + '</span>' +
        '<button class="copy-btn-icon" data-copy="' + ci + '" title="复制">📋</button>' +
        '</div>' +
        '<h4 class="copy-title">' + (copy.title || '') + '</h4>' +
        hookHtml +
        '<div class="copy-body">' + (copy.body || '') + '</div>' +
        shootingHtml +
        methodologyHtml +
        '<div class="copy-tags">' + tagsHtml + '</div>' +
        '</div>';
    });

    contentEl.innerHTML = html;

    // Bind copy buttons
    contentEl.querySelectorAll('.copy-btn-icon').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var ci = parseInt(this.dataset.copy);
        var copy = copies[ci];
        if (!copy) return;
        var text = '【' + (copy.version || '') + '】\n' +
          (copy.title || '') + '\n\n' +
          (copy.hook ? '🎬 开头：' + copy.hook + '\n\n' : '') +
          (copy.body || '') + '\n\n' +
          (copy.shooting_tip ? '🎥 拍摄：' + copy.shooting_tip + '\n' : '') +
          (copy.methodology_applied ? '💡 运营知识：' + copy.methodology_applied.join(' / ') + '\n' : '') +
          '\n' + (copy.tags ? copy.tags.join(' ') : '');
        copyToClipboard(text, '✅ 已复制「' + (copy.version || '发布文案') + '」');
      });
    });
  }

  // ===== 发布文案按钮 =====
  function initPublishCopyButtons() {
    document.querySelectorAll('.btn-publish-copy').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topicIdx = parseInt(this.dataset.topicIdx);
        if (isNaN(topicIdx)) return;
        handlePublishCopy(topicIdx);
      });
    });
  }

  // ===== 发布文案重试 =====
  function initPublishRetryButtons() {
    document.querySelectorAll('.btn-retry-publish').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var topicIdx = parseInt(this.dataset.topicIdx);
        if (isNaN(topicIdx)) return;
        handlePublishCopy(topicIdx);
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
    initTopicProductButtons();
    initTopicOralButtons();
    initTopicRegenerateButtons();
    initTopicRetryButtons();
    initPublishCopyButtons();
    initPublishRetryButtons();
    initCopyCodeButtons();
    initWechatDetection();

    // 初始状态
    setPhase('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
