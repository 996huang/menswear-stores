/**
 * 仟徒男装 · 门店页面上传表单逻辑
 * 纯前端实现：生成产品说明文件、复制文本、表单交互
 */

(function() {
  'use strict';

  // ===== 产品描述表单 =====
  function initProductForm() {
    const form = document.getElementById('product-form');
    if (!form) return;

    const btnDownload = document.getElementById('btn-download-txt');
    const btnCopy = document.getElementById('btn-copy-text');
    const btnPreview = document.getElementById('btn-preview');

    // 生成格式化的产品说明文本
    function generateText() {
      const storeName = form.dataset.storeName || '';
      const storeBrands = form.dataset.storeBrands || '';
      const now = new Date();
      const dateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      const productName = (form.querySelector('#prod-name') || {}).value || '未填写';
      const brand = (form.querySelector('#prod-brand') || {}).value || '未选择';
      const price = (form.querySelector('#prod-price') || {}).value || '未填写';
      const features = (form.querySelector('#prod-features') || {}).value || '未填写';
      const target = (form.querySelector('#prod-target') || {}).value || '未填写';
      const style = (form.querySelector('#prod-style') || {}).value || '未填写';
      const notes = (form.querySelector('#prod-notes') || {}).value || '';

      return `📥 产品文案生成请求
==================
门店：${storeName}
日期：${dateStr}
------------------
产品名称：${productName}
品牌：${brand}
吊牌价：${price}
风格：${style}
核心卖点：${features}
目标客群：${target}
补充说明：${notes}
门店品牌：${storeBrands}
------------------
📌 请基于以上信息生成：
  1. 品牌故事型文案
  2. 场景痛点解决型文案
  3. 情感共鸣型文案
  附带拍摄脚本、推荐标签、本地化建议
`;
    }

    // 下载 .txt 文件
    if (btnDownload) {
      btnDownload.addEventListener('click', function() {
        const text = generateText();
        if (!text.includes('未填写') || text.includes('未选择')) {
          // At least some fields filled
        }
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const storeId = form.dataset.storeId || 'store';
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `产品生成请求_${storeId}_${dateStr}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ 产品说明文件已下载');
      });
    }

    // 复制到剪贴板
    if (btnCopy) {
      btnCopy.addEventListener('click', async function() {
        const text = generateText();
        try {
          await navigator.clipboard.writeText(text);
          showToast('✅ 已复制，请粘贴保存到上传文件夹');
        } catch (err) {
          // Fallback for older browsers
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast('✅ 已复制，请粘贴保存到上传文件夹');
        }
      });
    }

    // 预览
    if (btnPreview) {
      btnPreview.addEventListener('click', function() {
        const text = generateText();
        const previewBox = document.getElementById('preview-box');
        if (previewBox) {
          previewBox.textContent = text;
          previewBox.style.display = previewBox.style.display === 'block' ? 'none' : 'block';
        }
      });
    }
  }

  // ===== Toast 提示 =====
  function showToast(msg) {
    let toast = document.getElementById('toast');
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
    }, 2500);
  }

  // ===== 上传指引切换 =====
  function initMethodTabs() {
    const tabs = document.querySelectorAll('.method-tab');
    if (!tabs.length) return;
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
      });
    });
  }

  // ===== 初始化 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProductForm);
  } else {
    initProductForm();
  }
})();
