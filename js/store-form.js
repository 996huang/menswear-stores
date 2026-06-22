/**
 * 仟徒男装 · 门店页面上传表单逻辑
 * 支持：拍照/选图预览 + 产品说明生成 + 一键复制/下载
 */
(function() {
  'use strict';

  var selectedImages = []; // {name, dataUrl, file}

  // ===== 图片选择 =====
  function initPhotoInput() {
    var input = document.getElementById('prod-photos');
    var previewContainer = document.getElementById('photo-previews');
    if (!input || !previewContainer) return;

    input.addEventListener('change', function(e) {
      var files = Array.from(e.target.files || []);
      if (!files.length) return;

      files.forEach(function(file) {
        if (!file.type.match(/image\/(jpeg|png|heic|heif|webp)/i)) {
          if (file.type || file.size > 0) {
            showToast('⚠️ 请选择图片文件（JPG/PNG/HEIC）');
          }
          return;
        }
        if (selectedImages.length >= 5) {
          showToast('⚠️ 最多选择5张图片');
          return;
        }
        var reader = new FileReader();
        reader.onload = function(ev) {
          selectedImages.push({
            name: file.name,
            dataUrl: ev.target.result,
            size: file.size
          });
          renderPreviews();
        };
        reader.readAsDataURL(file);
      });
      // Reset input so same file can be re-selected
      input.value = '';
    });

    // Initial render
    renderPreviews();
  }

  function renderPreviews() {
    var container = document.getElementById('photo-previews');
    if (!container) return;

    var countEl = document.getElementById('photo-count');
    if (countEl) {
      countEl.textContent = selectedImages.length ? selectedImages.length + '张已选' : '';
    }

    if (!selectedImages.length) {
      container.innerHTML = '<div style="color:var(--muted);font-size:.72em;text-align:center;padding:8px">📷 点击上方按钮，可选择「拍照」或「照片图库」（最多5张）</div>';
      return;
    }

    var html = '';
    selectedImages.forEach(function(img, i) {
      html += '<div class="photo-thumb">' +
        '<img src="' + img.dataUrl + '" alt="' + img.name + '">' +
        '<button class="photo-remove" data-idx="' + i + '" title="移除">✕</button>' +
        '<div class="photo-name">' + (img.name || '图片' + (i+1)) + '</div>' +
        '</div>';
    });
    container.innerHTML = html;

    // Bind remove buttons
    container.querySelectorAll('.photo-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        selectedImages.splice(idx, 1);
        renderPreviews();
      });
    });
  }

  // ===== 产品描述表单 =====
  function initProductForm() {
    var form = document.getElementById('product-form');
    if (!form) return;

    var btnDownload = document.getElementById('btn-download-txt');
    var btnCopy = document.getElementById('btn-copy-text');
    var btnPreview = document.getElementById('btn-preview');

    function getVal(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    function generateText() {
      var storeName = form.dataset.storeName || '';
      var storeBrands = form.dataset.storeBrands || '';
      var now = new Date();
      var dateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      var productName = getVal('prod-name') || '未填写';
      var brand = getVal('prod-brand') || '未选择';
      var price = getVal('prod-price') || '未填写';
      var features = getVal('prod-features') || '未填写';
      var target = getVal('prod-target') || '未填写';
      var style = getVal('prod-style') || '未填写';
      var notes = getVal('prod-notes') || '';

      var text = '📥 产品文案生成请求\n' +
        '==================\n' +
        '门店：' + storeName + '\n' +
        '日期：' + dateStr + '\n' +
        '------------------\n' +
        '产品名称：' + productName + '\n' +
        '品牌：' + brand + '\n' +
        '吊牌价：' + price + '\n' +
        '风格：' + style + '\n' +
        '核心卖点：' + features + '\n' +
        '目标客群：' + target + '\n' +
        '补充说明：' + notes + '\n' +
        '门店品牌：' + storeBrands + '\n';

      if (selectedImages.length) {
        text += '------------------\n' +
          '已选图片：' + selectedImages.length + '张\n';
        selectedImages.forEach(function(img, i) {
          text += '  ' + (i+1) + '. ' + img.name + '\n';
        });
        text += '📸 请将图片与此说明文件一起放入上传文件夹\n';
      }

      text += '------------------\n' +
        '📌 请基于以上信息生成：\n' +
        '  1. 品牌故事型文案\n' +
        '  2. 场景痛点解决型文案\n' +
        '  3. 情感共鸣型文案\n' +
        '  附带拍摄脚本、推荐标签、本地化建议\n';

      if (selectedImages.length) {
        text += '\n===== 图片Base64（共' + selectedImages.length + '张）=====\n';
        selectedImages.forEach(function(img, i) {
          text += '\n--- 图片' + (i+1) + ': ' + img.name + ' ---\n';
          text += img.dataUrl + '\n';
        });
      }

      return text;
    }

    // Download .txt file (with images embedded as base64 if selected)
    if (btnDownload) {
      btnDownload.addEventListener('click', function() {
        var text = generateText();
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var storeId = form.dataset.storeId || 'store';
        var dateStr = new Date().toISOString().slice(0, 10);
        a.download = '产品生成请求_' + storeId + '_' + dateStr + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ 产品说明文件已下载\\uFF0C请保存到上传文件夹');
      });
    }

    // Copy to clipboard (text only, no base64 images)
    if (btnCopy) {
      btnCopy.addEventListener('click', async function() {
        var storeName = form.dataset.storeName || '';
        var storeBrands = form.dataset.storeBrands || '';
        var now = new Date();
        var dateStr = now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0');

        var text = '📥 产品文案生成请求\n' +
          '==================\n' +
          '门店：' + storeName + '\n' +
          '日期：' + dateStr + '\n' +
          '------------------\n' +
          '产品名称：' + getVal('prod-name') + '\n' +
          '品牌：' + getVal('prod-brand') + '\n' +
          '吊牌价：' + getVal('prod-price') + '\n' +
          '风格：' + getVal('prod-style') + '\n' +
          '核心卖点：' + getVal('prod-features') + '\n' +
          '目标客群：' + getVal('prod-target') + '\n' +
          '补充说明：' + getVal('prod-notes') + '\n';

        if (selectedImages.length) {
          text += '已选图片：' + selectedImages.length + '张\n';
        }

        try {
          await navigator.clipboard.writeText(text);
          showToast('✅ 已复制，请粘贴到上传文件夹的“产品说明.txt”');
        } catch (err) {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast('✅ 已复制');
        }
      });
    }

    // Preview
    if (btnPreview) {
      btnPreview.addEventListener('click', function() {
        var text = generateText();
        var previewBox = document.getElementById('preview-box');
        if (previewBox) {
          // Show text part only (truncate base64)
          var lines = text.split('\n');
          var displayLines = [];
          var inBase64 = false;
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('===== 图片Base64') === 0) {
              displayLines.push('\n... 图片数据已嵌入（' + selectedImages.length + '张）...');
              break;
            }
            displayLines.push(lines[i]);
          }
          previewBox.textContent = displayLines.join('\n');
          previewBox.style.display = previewBox.style.display === 'block' ? 'none' : 'block';
          if (previewBox.style.display === 'block') {
            previewBox.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    }
  }

  // ===== Toast 提示 =====
  function showToast(msg) {
    var toast = document.getElementById('toast');
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

  // ===== 初始化 =====
  function init() {
    initPhotoInput();
    initProductForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
