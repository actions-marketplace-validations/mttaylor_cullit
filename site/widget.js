"use strict";(()=>{(function(){"use strict";let b=`
    .cullit-widget-trigger {
      position: fixed;
      z-index: 99999;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #e8ff47;
      color: #0a0a0a;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.2s, box-shadow 0.2s;
      font-size: 20px;
    }
    .cullit-widget-trigger:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    }
    .cullit-widget-trigger[data-count]:not([data-count="0"])::after {
      content: attr(data-count);
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ff4444;
      color: white;
      font-size: 11px;
      font-weight: bold;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cullit-widget-panel {
      position: fixed;
      z-index: 10002;
      width: 380px;
      max-height: 520px;
      background: #1a1a2e;
      color: #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .cullit-widget-panel.open { display: flex; }
    .cullit-widget-header {
      padding: 16px 20px;
      background: #16213e;
      border-bottom: 1px solid #2a2a4a;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cullit-widget-header h3 {
      margin: 0;
      font-size: 16px;
      color: #e8ff47;
    }
    .cullit-widget-close {
      background: none;
      border: none;
      color: #999;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
    }
    .cullit-widget-body {
      padding: 16px 20px;
      overflow-y: auto;
      flex: 1;
    }
    .cullit-widget-release {
      margin-bottom: 20px;
    }
    .cullit-widget-version {
      font-size: 14px;
      font-weight: 600;
      color: #e8ff47;
      margin-bottom: 4px;
    }
    .cullit-widget-date {
      font-size: 12px;
      color: #888;
      margin-bottom: 8px;
    }
    .cullit-widget-change {
      font-size: 13px;
      line-height: 1.5;
      padding: 2px 0;
    }
    .cullit-widget-footer {
      padding: 8px 20px;
      text-align: center;
      border-top: 1px solid #2a2a4a;
      font-size: 11px;
    }
    .cullit-widget-footer a {
      color: #e8ff47;
      text-decoration: none;
    }
    /* Positions */
    .cullit-pos-br .cullit-widget-trigger { bottom: 24px; right: 24px; }
    .cullit-pos-br .cullit-widget-panel { bottom: 84px; right: 24px; }
    .cullit-pos-bl .cullit-widget-trigger { bottom: 24px; left: 24px; }
    .cullit-pos-bl .cullit-widget-panel { bottom: 84px; left: 24px; }
    .cullit-pos-tr .cullit-widget-trigger { top: 24px; right: 24px; }
    .cullit-pos-tr .cullit-widget-panel { top: 84px; right: 24px; }
    .cullit-pos-tl .cullit-widget-trigger { top: 24px; left: 24px; }
    .cullit-pos-tl .cullit-widget-panel { top: 84px; left: 24px; }
  `,f={"bottom-right":"br","bottom-left":"bl","top-right":"tr","top-left":"tl"},h={features:"\u2728",fixes:"\u{1F41B}",breaking:"\u26A0\uFE0F",improvements:"\u{1F527}",chores:"\u{1F9F9}",other:"\u{1F4DD}"};function c(i){let r=f[i.position||"bottom-right"]||"br",m=i.apiUrl||"https://api.cullit.io/v1/changelog",w=i.branding!==!1,p=document.createElement("style");p.textContent=b,document.head.appendChild(p);let a=document.createElement("div");a.className=`cullit-widget cullit-pos-${r}`;let e=document.createElement("button");e.className="cullit-widget-trigger",e.innerHTML="\u{1F514}",e.setAttribute("aria-label","What's New"),e.setAttribute("data-count","0");let t=document.createElement("div");t.className="cullit-widget-panel",t.innerHTML=`
      <div class="cullit-widget-header">
        <h3>What's New</h3>
        <button class="cullit-widget-close" aria-label="Close">&times;</button>
      </div>
      <div class="cullit-widget-body">
        <p style="color:#888">Loading...</p>
      </div>
      ${w?'<div class="cullit-widget-footer">Powered by <a href="https://cullit.io" target="_blank" rel="noopener">Cullit</a></div>':""}
    `,a.appendChild(e),a.appendChild(t),document.body.appendChild(a),e.addEventListener("click",()=>{t.classList.toggle("open"),t.classList.contains("open")&&(e.setAttribute("data-count","0"),localStorage.setItem("cullit_widget_seen",new Date().toISOString()))}),t.querySelector(".cullit-widget-close").addEventListener("click",()=>{t.classList.remove("open")}),fetch(`${m}/${encodeURIComponent(i.project)}/latest`).then(n=>n.ok?n.json():Promise.reject(n)).then(n=>{let g=t.querySelector(".cullit-widget-body"),s=n.releases||[];if(s.length===0){g.innerHTML='<p style="color:#888">No releases yet.</p>';return}let u=localStorage.getItem("cullit_widget_seen"),y=u?s.filter(l=>new Date(l.date)>new Date(u)).length:s.length;e.setAttribute("data-count",String(Math.min(y,9))),g.innerHTML=s.map(l=>`
          <div class="cullit-widget-release">
            <div class="cullit-widget-version">${d(l.version)}</div>
            <div class="cullit-widget-date">${d(l.date)}</div>
            ${l.changes.map(x=>`<div class="cullit-widget-change">${h[x.category]||"\u2022"} ${d(x.description)}</div>`).join("")}
          </div>
        `).join("")}).catch(()=>{t.querySelector(".cullit-widget-body").innerHTML='<p style="color:#888">Could not load changelog.</p>'})}function d(i){let r=document.createElement("div");return r.textContent=i,r.innerHTML}let o=document.currentScript;o?.dataset.project&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>c({project:o.dataset.project,position:o.dataset.position,accentColor:o.dataset.accentColor,headerText:o.dataset.headerText,triggerEmoji:o.dataset.triggerEmoji})):c({project:o.dataset.project,position:o.dataset.position,accentColor:o.dataset.accentColor,headerText:o.dataset.headerText,triggerEmoji:o.dataset.triggerEmoji})),window.CullitWidget={init:c}})();})();
