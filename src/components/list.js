import { getLeadsFilteredByAgent, getAllLeads, getLeadById, updateLead, addLead, deleteLead, addLog, getStatusFromPipelineState } from '../db.js';
import { fetchCSV, parseCSV, autoDetectMapping } from '../importer.js';

export const PIPELINE_STATES = {
  'enviado': { label: 'Enviado', color: '#60a5fa' },
  'contestado': { label: 'Contestado', color: '#3b82f6' },
  'no contesta': { label: 'No contesta', color: '#94a3b8' },
  'no_wasap': { label: 'No Wasap', color: '#f43f5e' },
  'pide info': { label: 'Pide info', color: '#fb923c' },
  'cuanto cuesta': { label: 'Cuánto cuesta', color: '#f59e0b' },
  'podemos quedar': { label: 'Podemos quedar', color: '#818cf8' },
  'mas info': { label: 'Más info', color: '#fbbf24' },
  'cita': { label: 'Cita', color: '#a78bfa' },
  'envio demo': { label: 'Envío demo', color: '#2dd4bf' },
  'llamar': { label: 'Llamar', color: '#ec4899' },
  'presupuesto': { label: 'Presupuesto', color: '#14b8a6' },
  'firmado': { label: 'Firmado', color: '#10b981' },
  'haciendo': { label: 'Haciendo', color: '#06b6d4' },
  'cobro parcial': { label: 'Cobro parcial', color: '#f43f5e' },
  'cobro total': { label: 'Cobro total', color: '#e11d48' },
  'implementado': { label: 'Implementado', color: '#8b5cf6' },
  'con mensualidad': { label: 'Con mensualidad', color: '#d946ef' },
  'finalizado': { label: 'Finalizado', color: '#16a34a' },
  'descartado': { label: 'Descartado', color: '#ef4444' }
};

export function buildPipelineSelectHTML(lead) {
  const currentVal = lead.pipelineState || '';
  const stateConfig = PIPELINE_STATES[currentVal] || { label: 'Seleccionar...', color: '#94a3b8' };
  const color = stateConfig.color;
  
  const optionsHTML = Object.entries(PIPELINE_STATES).map(([key, val]) => {
    const selected = currentVal === key ? 'selected' : '';
    return `<option value="${key}" ${selected}>${val.label}</option>`;
  }).join('');

  return `
    <select class="pipeline-select" data-leadid="${lead.id}" style="
      background: ${color}15;
      color: ${color};
      border: 1px solid ${color}40;
    ">
      <option value="" ${currentVal === '' ? 'selected' : ''}>-- Ninguno --</option>
      ${optionsHTML}
    </select>
  `;
}

let onLeadClickCallback = null;
let onListUpdatedCallback = null;
let _containerId = null;

export function initList(onLeadClick, onListUpdated) {
  onLeadClickCallback = onLeadClick;
  onListUpdatedCallback = onListUpdated;
}

function collectCustomFieldKeys(leads) {
  const keysOrder = [];
  const seen = new Set();
  leads.forEach(lead => {
    if (lead.customFields && typeof lead.customFields === 'object') {
      Object.keys(lead.customFields).forEach(k => {
        if (!seen.has(k)) { seen.add(k); keysOrder.push(k); }
      });
    }
  });
  return keysOrder;
}

function agentBadge(agent) {
  if (agent === 'jordan') return `<span class="list-agent-badge jordan">Jordan</span>`;
  if (agent === 'sandra') return `<span class="list-agent-badge sandra">Sandra</span>`;
  return `<span class="list-agent-badge unassigned">Sin asignar</span>`;
}

export function buildAgentSelectHTML(lead) {
  const currentVal = lead.agent || '';
  let color = '#94a3b8'; // Sin asignar
  if (currentVal === 'jordan') color = '#a78bfa';

  return `
    <select class="agent-select" data-leadid="${lead.id}" style="
      background: ${color}15;
      color: ${color};
      border: 1px solid ${color}40;
    ">
      <option value="" ${currentVal === '' ? 'selected' : ''}>Sin asignar</option>
      <option value="jordan" ${currentVal === 'jordan' ? 'selected' : ''}>Jordan</option>
    </select>
  `;
}

function statusBadge(status) {
  const map = {
    new:            { label: 'Nuevo',        color: '#818cf8' },
    contacted:      { label: 'Contactado',   color: '#34d399' },
    'no-response':  { label: 'Sin Respuesta',color: '#f59e0b' },
    'no-wasap':     { label: 'No Wasap',     color: '#f43f5e' },
    interested:     { label: 'Interesado',   color: '#a78bfa' },
    meeting:        { label: 'Reunión',      color: '#60a5fa' },
    won:            { label: 'Ganado',       color: '#10b981' },
    lost:           { label: 'Descartado',   color: '#f87171' },
    archived:       { label: 'Archivado',    color: '#6b7280' },
  };
  const s = map[status] || { label: status || 'Nuevo', color: '#818cf8' };
  return `<span class="list-status-badge" style="color:${s.color};background:${s.color}18;">${s.label}</span>`;
}

// Returns the "other" agent for transfer action
function otherAgent(agent) {
  return null;
}

function otherAgentLabel(agent) {
  return null;
}

// ── Confirmation popup (custom, animated) ─────────────────────────────────────
function showConfirmPopup(message, onConfirm) {
  // Remove any existing
  document.getElementById('list-confirm-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'list-confirm-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
    z-index: 9999; display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.15s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background: var(--bg-elevated, #1e1e2e);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 28px 32px;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      animation: slideUp 0.2s ease;
    ">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <span style="
          width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,0.15);
          display:flex;align-items:center;justify-content:center;flex-shrink:0;
        ">
          <svg style="width:18px;height:18px;color:#f87171" fill="none" stroke="#f87171" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
        </span>
        <h3 style="margin:0;font-size:16px;font-weight:600;color:var(--text-primary)">Confirmar acción</h3>
      </div>
      <p style="color:var(--text-secondary);font-size:14px;margin:0 0 24px;line-height:1.6;">${message}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="list-confirm-cancel" style="
          padding:9px 18px;border-radius:8px;border:1px solid var(--border-color);
          background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;
          transition:all 0.15s;
        ">Cancelar</button>
        <button id="list-confirm-ok" style="
          padding:9px 18px;border-radius:8px;border:none;
          background:rgba(239,68,68,0.85);color:#fff;font-size:13px;font-weight:600;cursor:pointer;
          transition:all 0.15s;
        ">Eliminar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('list-confirm-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('list-confirm-ok').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Inline edit cell (double-click on a td) ───────────────────────────────────
function makeEditable(td, lead, fieldKey, isCustom, rawKey, containerId) {
  td.addEventListener('dblclick', async (e) => {
    e.stopPropagation();
    if (td.querySelector('input')) return; // already editing
    const original = isCustom ? (lead.customFields?.[rawKey] ?? '') : (lead[fieldKey] ?? '');
    const input = document.createElement('input');
    input.value = original;
    input.style.cssText = `
      width: 100%; background: var(--bg-elevated, #1e1e2e); border: 1px solid var(--accent-purple);
      border-radius: 4px; color: var(--text-primary); font-size: 13px;
      padding: 3px 6px; outline: none; box-sizing: border-box;
    `;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
      const newVal = input.value.trim();
      const fresh = await getLeadById(lead.id);
      if (!fresh) return;
      if (isCustom) {
        fresh.customFields = fresh.customFields || {};
        fresh.customFields[rawKey] = newVal;
      } else {
        fresh[fieldKey] = newVal;
      }
      await updateLead(fresh);
      await addLog(lead.id, 'system', `Campo "${isCustom ? rawKey : fieldKey}" editado directamente en la Lista.`);
      await renderList(containerId);
      if (onListUpdatedCallback) onListUpdatedCallback();
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { input.blur(); }
      if (ev.key === 'Escape') {
        td.textContent = original || '—';
        input.removeEventListener('blur', save);
      }
    });
  });
}

export function getColumnsConfig(leads) {
  const customKeys = collectCustomFieldKeys(leads);
  const standardCols = [
    { key: 'syncStatus', label: 'Sincro' },
    { key: 'pipelineState', label: 'Seguimiento' },
    { key: 'name',    label: 'Nombre' },
    { key: 'company', label: 'Empresa' },
    { key: 'phone',   label: 'Teléfono' },
    { key: 'email',   label: 'Correo' },
    { key: 'website', label: 'Web' },
    { key: 'status',  label: 'Estado' },
    { key: 'agent',   label: 'Agente' },
  ];
  
  const defaultCols = [
    ...standardCols.map(c => ({ ...c, visible: true })),
    ...customKeys.map(k => ({ key: `cf_${k}`, label: k, isCustom: true, rawKey: k, visible: true }))
  ];

  const stored = localStorage.getItem('gespropec_list_columns_config');
  if (!stored) {
    return defaultCols;
  }

  try {
    const config = JSON.parse(stored);
    const merged = [];
    const configKeys = new Set(config.map(c => c.key));

    config.forEach(c => {
      const defMatch = defaultCols.find(dc => dc.key === c.key);
      if (defMatch) {
        merged.push({
          key: c.key,
          label: defMatch.label,
          visible: c.visible !== false,
          isCustom: defMatch.isCustom || false,
          rawKey: defMatch.rawKey || undefined
        });
      }
    });

    defaultCols.forEach(dc => {
      if (!configKeys.has(dc.key)) {
        merged.push({ ...dc });
      }
    });

    return merged;
  } catch (e) {
    console.error('Error parsing column configuration, returning default:', e);
    return defaultCols;
  }
}

function renderPopupListItems(listContainer, colsCopy) {
  listContainer.innerHTML = '';
  colsCopy.forEach((col, index) => {
    const li = document.createElement('div');
    li.className = 'col-config-item';
    li.draggable = true;
    li.dataset.index = index;
    li.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: grab;
      user-select: none;
      transition: all 0.15s ease;
    `;
    
    li.addEventListener('mouseenter', () => {
      li.style.background = 'rgba(255, 255, 255, 0.06)';
      li.style.borderColor = 'var(--accent-purple)';
    });
    li.addEventListener('mouseleave', () => {
      li.style.background = 'rgba(255, 255, 255, 0.03)';
      li.style.borderColor = 'var(--border-color)';
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = col.visible !== false;
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      accent-color: var(--accent-purple);
      cursor: pointer;
    `;
    checkbox.addEventListener('change', () => {
      col.visible = checkbox.checked;
    });

    const handle = document.createElement('span');
    handle.innerHTML = `
      <svg style="width:16px;height:16px;color:var(--text-muted);cursor:grab;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/>
      </svg>
    `;
    handle.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const label = document.createElement('span');
    label.textContent = col.label;
    label.style.cssText = `
      flex-grow: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
    `;

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
      display: flex;
      gap: 4px;
    `;

    const upBtn = document.createElement('button');
    upBtn.innerHTML = '▲';
    upBtn.title = 'Subir columna';
    upBtn.style.cssText = `
      border: 1px solid var(--border-color);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-secondary);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.15s;
    `;
    if (index === 0) {
      upBtn.disabled = true;
      upBtn.style.opacity = '0.3';
      upBtn.style.cursor = 'not-allowed';
    } else {
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const temp = colsCopy[index];
        colsCopy[index] = colsCopy[index - 1];
        colsCopy[index - 1] = temp;
        renderPopupListItems(listContainer, colsCopy);
      });
      upBtn.addEventListener('mouseenter', () => {
        upBtn.style.borderColor = 'var(--accent-purple)';
        upBtn.style.color = '#fff';
      });
      upBtn.addEventListener('mouseleave', () => {
        upBtn.style.borderColor = 'var(--border-color)';
        upBtn.style.color = 'var(--text-secondary)';
      });
    }

    const downBtn = document.createElement('button');
    downBtn.innerHTML = '▼';
    downBtn.title = 'Bajar columna';
    downBtn.style.cssText = `
      border: 1px solid var(--border-color);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-secondary);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.15s;
    `;
    if (index === colsCopy.length - 1) {
      downBtn.disabled = true;
      downBtn.style.opacity = '0.3';
      downBtn.style.cursor = 'not-allowed';
    } else {
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const temp = colsCopy[index];
        colsCopy[index] = colsCopy[index + 1];
        colsCopy[index + 1] = temp;
        renderPopupListItems(listContainer, colsCopy);
      });
      downBtn.addEventListener('mouseenter', () => {
        downBtn.style.borderColor = 'var(--accent-purple)';
        downBtn.style.color = '#fff';
      });
      downBtn.addEventListener('mouseleave', () => {
        downBtn.style.borderColor = 'var(--border-color)';
        downBtn.style.color = 'var(--text-secondary)';
      });
    }

    btnContainer.appendChild(upBtn);
    btnContainer.appendChild(downBtn);

    li.appendChild(handle);
    li.appendChild(checkbox);
    li.appendChild(label);
    li.appendChild(btnContainer);

    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', index);
      li.style.opacity = '0.4';
      li.style.borderStyle = 'dashed';
      li.style.borderColor = 'var(--accent-purple)';
    });

    li.addEventListener('dragend', () => {
      li.style.opacity = '1';
      li.style.borderStyle = 'solid';
      li.style.borderColor = 'var(--border-color)';
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.style.background = 'rgba(124, 58, 237, 0.1)';
      li.style.borderColor = 'var(--accent-purple)';
    });

    li.addEventListener('dragleave', () => {
      li.style.background = 'rgba(255, 255, 255, 0.03)';
      li.style.borderColor = 'var(--border-color)';
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const toIndex = index;
      if (fromIndex !== toIndex) {
        const [movedItem] = colsCopy.splice(fromIndex, 1);
        colsCopy.splice(toIndex, 0, movedItem);
        renderPopupListItems(listContainer, colsCopy);
      }
    });

    listContainer.appendChild(li);
  });
}

export function showColumnsConfigPopup(leads, containerId) {
  document.getElementById('list-columns-overlay')?.remove();

  const colsCopy = JSON.parse(JSON.stringify(getColumnsConfig(leads)));

  const overlay = document.createElement('div');
  overlay.id = 'list-columns-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px);
    z-index: 9999; display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.15s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background: var(--bg-surface, #0f0f15);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 24px;
      max-width: 450px;
      width: 90%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      animation: slideUp 0.2s ease;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid var(--border-color);padding-bottom:12px;">
        <h3 style="margin:0;font-size:18px;font-family:var(--font-heading);font-weight:600;color:var(--text-primary)">Configurar Columnas</h3>
        <button id="list-columns-close" style="
          border:none;background:none;color:var(--text-secondary);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;
        ">
          <svg style="width:20px;height:20px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      
      <p style="color:var(--text-secondary);font-size:12px;margin:0 0 16px;line-height:1.4;">
        Arrastra las columnas o usa los botones (▲/▼) para reordenarlas. Desmarca las casillas para ocultar columnas en la tabla.
      </p>

      <div id="list-columns-items-container" style="
        flex-grow: 1;
        overflow-y: auto;
        padding-right: 4px;
        margin-bottom: 20px;
        max-height: 45vh;
      ">
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border-color);padding-top:16px;">
        <button id="list-columns-reset" style="
          padding:9px 14px;border-radius:8px;border:1px solid var(--border-color);
          background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;
          transition:all 0.15s;
        ">Restablecer</button>
        
        <div style="display:flex;gap:10px;">
          <button id="list-columns-cancel" style="
            padding:9px 18px;border-radius:8px;border:1px solid var(--border-color);
            background:none;color:var(--text-secondary);font-size:13px;cursor:pointer;
            transition:all 0.15s;
          ">Cancelar</button>
          <button id="list-columns-save" style="
            padding:9px 18px;border-radius:8px;border:none;
            background:var(--accent-purple);color:#fff;font-size:13px;font-weight:600;cursor:pointer;
            transition:all 0.15s;
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.2);
          ">Guardar y Aplicar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const listContainer = document.getElementById('list-columns-items-container');
  renderPopupListItems(listContainer, colsCopy);

  const closePopup = () => overlay.remove();
  document.getElementById('list-columns-close').addEventListener('click', closePopup);
  document.getElementById('list-columns-cancel').addEventListener('click', closePopup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });

  document.getElementById('list-columns-reset').addEventListener('click', () => {
    localStorage.removeItem('gespropec_list_columns_config');
    closePopup();
    renderList(containerId);
    if (onListUpdatedCallback) onListUpdatedCallback();
  });

  document.getElementById('list-columns-save').addEventListener('click', async () => {
    localStorage.setItem('gespropec_list_columns_config', JSON.stringify(colsCopy));
    closePopup();
    await renderList(containerId);
    if (onListUpdatedCallback) onListUpdatedCallback();
  });
}

export async function renderList(containerId) {
  _containerId = containerId;
  const container = document.getElementById(containerId);
  if (!container) return;

  // Preserve the search query before clearing
  const searchInput = document.getElementById('list-search-input');
  const preservedQuery = searchInput ? searchInput.value : '';

  container.innerHTML = '<div class="notifications-empty" style="padding:40px">Cargando lista...</div>';

  try {
    const leads = await getLeadsFilteredByAgent();
    const active   = leads.filter(l => l.status !== 'archived');
    const archived = leads.filter(l => l.status === 'archived');
    const columnsConfig = getColumnsConfig(leads);

    container.innerHTML = `
      <div class="list-toolbar">
        <div class="list-search-wrap">
          <svg style="width:15px;height:15px;color:var(--text-muted);flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" id="list-search-input" class="list-search-input" placeholder="Buscar por nombre, empresa, teléfono…">
        </div>
        <div class="list-toolbar-right">
          <span class="list-count-label" id="list-count-label">${active.length} prospectos</span>
          <button id="list-sync-sheets-btn" class="btn-list-action" title="Sincronizar con Google Sheets" style="border-color: rgba(59, 130, 246, 0.4); color: #60a5fa;">
            <svg id="list-sync-icon" style="width:14px;height:14px;transition: transform 1s ease;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89H18M4 20v-5h.581m15.357-2a8.001 8.001 0 11-21.21 4.11H6"/>
            </svg>
            <span id="list-sync-text">Sincronizar</span>
          </button>
          <button id="list-columns-config-btn" class="btn-list-action" title="Configurar Columnas">
            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            Columnas
          </button>
          <button id="list-export-csv-btn" class="btn-list-action" title="Exportar a CSV">
            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Exportar CSV
          </button>
          ${active.length > 0 ? `
          <button id="list-delete-all-btn" class="btn-list-action" title="Eliminar todos los prospectos visibles" style="
            border-color: rgba(239,68,68,0.35); color: #f87171;
          ">
            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2"/>
            </svg>
            Borrar todo
          </button>
          ` : ''}
        </div>
      </div>

      <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px;padding-left:2px;">
        💡 Doble clic en cualquier celda para editar directamente · Hover sobre una fila para ver las acciones
      </p>

      <div class="list-table-wrap" id="list-table-wrap">
        ${buildTableHTML(active, columnsConfig, 'active')}
      </div>

      ${archived.length > 0 ? `
        <div class="list-archived-toggle" id="list-archived-toggle">
          <svg style="width:14px;height:14px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"/>
          </svg>
          Ver archivados (${archived.length})
          <svg class="toggle-arrow" style="width:12px;height:12px;transition:transform 0.2s" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
        <div class="list-archived-wrap" id="list-archived-wrap" style="display:none;">
          ${buildTableHTML(archived, columnsConfig, 'archived')}
        </div>
      ` : ''}
    `;

    // Wire search
    const newSearchInput = document.getElementById('list-search-input');
    if (newSearchInput) {
      newSearchInput.value = preservedQuery;
      newSearchInput.addEventListener('input', (e) => {
        filterTable(e.target.value.toLowerCase(), active);
      });
      if (preservedQuery) {
        filterTable(preservedQuery.toLowerCase(), active);
      }
    }

    // Wire sync sheets
    document.getElementById('list-sync-sheets-btn')?.addEventListener('click', async () => {
      const syncBtn = document.getElementById('list-sync-sheets-btn');
      const syncIcon = document.getElementById('list-sync-icon');
      const syncText = document.getElementById('list-sync-text');

      if (!syncBtn || syncBtn.disabled) return;

      syncBtn.disabled = true;
      if (syncIcon) syncIcon.classList.add('spinning');
      if (syncText) syncText.textContent = 'Sincronizando...';

      try {
        const { countAdded, countUpdated } = await syncGoogleSheetsLeads();
        showToast(`Sincronización completada. Nuevos: ${countAdded}, Actualizados: ${countUpdated}`);
        await renderList(containerId);
        if (onListUpdatedCallback) onListUpdatedCallback();
      } catch (err) {
        console.error(err);
        showToast('Error en la sincronización. Verifica tu conexión.');
      } finally {
        if (syncIcon) syncIcon.classList.remove('spinning');
        if (syncText) syncText.textContent = 'Sincronizar';
        syncBtn.disabled = false;
      }
    });

    // Wire columns config
    document.getElementById('list-columns-config-btn')?.addEventListener('click', () => {
      showColumnsConfigPopup(leads, containerId);
    });

    // Wire export
    document.getElementById('list-export-csv-btn')?.addEventListener('click', () => {
      exportToCSV(active, columnsConfig);
    });

    // Wire delete-all
    document.getElementById('list-delete-all-btn')?.addEventListener('click', () => {
      const visibleRows = [...document.querySelectorAll('#list-table-active .list-row')]
        .filter(r => r.style.display !== 'none');
      const count = visibleRows.length;
      if (count === 0) return;

      showConfirmPopup(
        `Vas a eliminar <strong>${count} prospectos</strong> de forma permanente. Esta acción no se puede deshacer.`,
        async () => {
          const ids = visibleRows.map(r => r.dataset.id);
          for (const id of ids) await deleteLead(id);
          await renderList(containerId);
          if (onListUpdatedCallback) onListUpdatedCallback();
        }
      );
    });

    // Wire archive toggle
    document.getElementById('list-archived-toggle')?.addEventListener('click', () => {
      const wrap = document.getElementById('list-archived-wrap');
      const arrow = document.querySelector('#list-archived-toggle .toggle-arrow');
      const open = wrap.style.display !== 'none';
      wrap.style.display = open ? 'none' : 'block';
      if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
    });

    // Wire inline edit + row actions
    wireTable(active, containerId, false);
    wireTable(archived, containerId, true);

    // Initialize column resizing
    const activeTable = document.getElementById('list-table-active');
    if (activeTable) initColumnResizing(activeTable);
    const archivedTable = document.getElementById('list-table-archived');
    if (archivedTable) initColumnResizing(archivedTable);

  } catch (err) {
    console.error('Error rendering list:', err);
    container.innerHTML = '<div class="notifications-empty" style="color:var(--accent-red)">Error al cargar la lista.</div>';
  }
}

function buildTableHTML(leads, columnsConfig, tableId) {
  const visibleCols = columnsConfig.filter(col => col.visible !== false);

  if (leads.length === 0) {
    return `<div class="list-empty">
      <svg style="width:40px;height:40px;color:var(--text-muted);margin-bottom:12px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
      <p>No hay prospectos para mostrar</p>
    </div>`;
  }

  const savedWidths = JSON.parse(localStorage.getItem('gespropec_column_widths') || '{}');

  const indexWidth = savedWidths['__index'] ? `width: ${savedWidths['__index']}px; min-width: ${savedWidths['__index']}px;` : 'width: 50px; min-width: 50px;';
  const actionsWidth = savedWidths['__actions'] ? `width: ${savedWidths['__actions']}px; min-width: ${savedWidths['__actions']}px;` : 'width: 90px; min-width: 90px;';

  const indexHeader = `<th class="list-th list-th-index" data-col-key="__index" style="${indexWidth}">#</th>`;
  const actionsHeader = `<th class="list-th list-th-actions" data-col-key="__actions" style="${actionsWidth}">Acciones</th>`;

  const headerCells = visibleCols.map(col => {
    const widthVal = savedWidths[col.key];
    const styleAttr = widthVal ? `style="width: ${widthVal}px; min-width: ${widthVal}px;"` : '';
    
    const isPersonalizedMsgCol = col.label && (col.label.toLowerCase().trim() === 'mensaje personalizado' || col.label.toLowerCase().trim() === 'mensaje_personalizado');
    if (isPersonalizedMsgCol) {
      const isExpanded = localStorage.getItem('gespropec_expand_messages') === 'true';
      return `
        <th class="list-th" data-col-key="${col.key}" ${styleAttr}>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
            <span>${col.label}</span>
            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; text-transform: none; color: var(--text-muted); cursor: pointer; user-select: none; font-weight: normal; margin-right: 8px;">
              <input type="checkbox" class="toggle-expand-messages-chk" ${isExpanded ? 'checked' : ''} style="cursor: pointer; accent-color: var(--accent-purple); width: 12px; height: 12px; margin: 0;">
              <span>Expandir</span>
            </label>
          </div>
        </th>
      `;
    }
    
    return `<th class="list-th" data-col-key="${col.key}" ${styleAttr}>${col.label}</th>`;
  }).join('');

  const rows = leads.map((lead, index) => {
    const other = otherAgent(lead.agent);
    const otherLabel = otherAgentLabel(lead.agent);

    const cells = visibleCols.map(col => {
      if (col.key === 'syncStatus') {
        const lastSync = localStorage.getItem('gespropec_last_sync_time');
        const lastSyncTime = lastSync ? parseInt(lastSync, 10) : 0;
        const createdTime = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
        const updatedTime = lead.updatedAt ? new Date(lead.updatedAt).getTime() : 0;

        let badgeHtml = '';
        if (lastSyncTime > 0 && createdTime >= lastSyncTime) {
          badgeHtml = `<span class="sync-badge new" title="Añadido nuevo en la última sincronización" style="
            width: 8px; height: 8px; border-radius: 50%; background-color: #10b981; display: inline-block;
            box-shadow: 0 0 8px #10b981;
          "></span>`;
        } else if (lastSyncTime > 0 && updatedTime >= lastSyncTime && Math.abs(updatedTime - createdTime) > 1000) {
          badgeHtml = `<span class="sync-badge modified" title="Modificado en la última sincronización" style="
            width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6; display: inline-block;
            box-shadow: 0 0 8px #3b82f6;
          "></span>`;
        } else {
          badgeHtml = `<span class="sync-badge unchanged" title="Sin cambios" style="
            width: 8px; height: 8px; border-radius: 50%; background-color: #64748b; display: inline-block;
            opacity: 0.4;
          "></span>`;
        }

        return `<td class="list-td list-td-nobold" style="text-align: center; vertical-align: middle; width: 60px;">${badgeHtml}</td>`;
      }
      if (col.key === 'pipelineState') {
        return `<td class="list-td list-td-nobold" style="padding: 6px 14px; min-width: 140px;">${buildPipelineSelectHTML(lead)}</td>`;
      }
      if (col.key === 'status') {
        return `<td class="list-td list-td-nobold">${statusBadge(lead.status)}</td>`;
      }
      if (col.key === 'agent') {
        return `<td class="list-td list-td-nobold">${buildAgentSelectHTML(lead)}</td>`;
      }
      if (col.key === 'website' && lead[col.key]) {
        return `<td class="list-td list-td-nobold" title="${lead[col.key]}">
          <a href="${lead[col.key]}" target="_blank" class="list-link">${lead[col.key]}</a>
        </td>`;
      }
      const val = col.isCustom
        ? (lead.customFields?.[col.rawKey] ?? '')
        : (lead[col.key] ?? '');
      const isEditable = col.key !== 'status' && col.key !== 'agent' && col.key !== 'pipelineState' && col.key !== 'syncStatus';
      
      const isPersonalizedMsgCol = col.label && (col.label.toLowerCase().trim() === 'mensaje personalizado' || col.label.toLowerCase().trim() === 'mensaje_personalizado');

      if (isPersonalizedMsgCol && val) {
        return `<td class="list-td list-td-nobold${isEditable ? ' list-td-editable' : ''}"
          data-field="${col.isCustom ? col.rawKey : col.key}"
          data-custom="${col.isCustom ? '1' : '0'}"
          data-leadid="${lead.id}"
          title="${String(val).replace(/"/g, '&quot;')}"
          style="position: relative; padding-right: 40px; min-width: 200px;"
        >
          <span class="msg-cell-text">${val}</span>
          <button class="list-whatsapp-msg-btn" 
            data-msg="${String(val).replace(/"/g, '&quot;')}" 
            data-phone="${lead.phone || ''}" 
            title="Copiar mensaje y abrir WhatsApp"
            style="
              position: absolute;
              right: 8px;
              top: 50%;
              transform: translateY(-50%);
              background: #25D366;
              border: none;
              border-radius: 50%;
              width: 24px;
              height: 24px;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              box-shadow: 0 2px 6px rgba(37, 211, 102, 0.3);
              transition: all 0.15s ease;
              padding: 0;
              z-index: 5;
            "
          >
            <svg style="width: 14px; height: 14px; color: white;" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.012 2c-5.506 0-9.988 4.482-9.988 9.988 0 1.758.455 3.479 1.322 4.996L2 22l5.166-1.353c1.464.8 3.111 1.218 4.846 1.218 5.507 0 9.989-4.482 9.989-9.988S17.519 2 12.012 2zm4.721 13.51c-.244.686-1.236 1.249-1.725 1.293-.47.042-1.07.135-3.154-.725-2.665-1.1-4.332-3.8-4.464-3.977-.13-.176-1.053-1.402-1.053-2.673 0-1.272.668-1.893.903-2.138.235-.245.518-.307.69-.307.173 0 .345 0 .495.008.16.008.375-.062.587.452.22.533.753 1.838.818 1.972.065.134.11.29.02.47-.09.18-.135.3-.27.456-.135.156-.285.347-.406.467-.135.134-.277.28-.119.553.157.273.7 1.15 1.5 1.865.986.877 1.815 1.15 2.072 1.278.257.128.409.106.564-.074.156-.18.67-.78.85-.924.18-.145.36-.123.606-.032.247.09 1.565.738 1.832.872.267.134.445.2.51.312.065.112.065.65-.18 1.336z"/>
            </svg>
          </button>
        </td>`;
      }

      return `<td class="list-td${col.key === 'name' ? '' : ' list-td-nobold'}${isEditable ? ' list-td-editable' : ''}"
        data-field="${col.isCustom ? col.rawKey : col.key}"
        data-custom="${col.isCustom ? '1' : '0'}"
        data-leadid="${lead.id}"
        title="${String(val).replace(/"/g, '&quot;')}"
      >${val || '<span class="list-empty-cell">—</span>'}</td>`;
    }).join('');

    const indexCell = `<td class="list-td list-td-index">${index + 1}</td>`;

    return `
      <tr class="list-row" data-id="${lead.id}" data-agent="${lead.agent || ''}" data-search="${buildSearchStr(lead, columnsConfig)}">
        ${indexCell}
        <td class="list-td list-td-actions">
          <div class="list-row-actions">
            <!-- Edit -->
            <button class="list-action-btn" data-action="edit" data-id="${lead.id}" title="Editar prospecto">
              <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
              </svg>
            </button>
            <!-- Transfer to other agent -->
            ${other ? `
            <button class="list-action-btn transfer" data-action="transfer" data-id="${lead.id}" data-target="${other}"
              title="${otherLabel}" style="font-size:10px;gap:3px;">
              <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
              </svg>
            </button>` : ''}
            <!-- Archive (active only) / Restore (archived) -->
            ${tableId !== 'archived' ? `
            <button class="list-action-btn" data-action="archive" data-id="${lead.id}" title="Archivar">
              <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"/>
              </svg>
            </button>` : `
            <button class="list-action-btn restore" data-action="restore" data-id="${lead.id}" title="Restaurar">
              <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
              </svg>
            </button>`}
            <!-- Delete -->
            <button class="list-action-btn danger" data-action="delete" data-id="${lead.id}" data-name="${(lead.name||'').replace(/"/g,'')}" title="Eliminar permanentemente">
              <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2"/>
              </svg>
            </button>
          </div>
        </td>
        ${cells}
      </tr>
    `;
  }).join('');

  const isExpanded = localStorage.getItem('gespropec_expand_messages') === 'true';
  return `
    <table class="list-table ${isExpanded ? 'expand-messages' : ''}" id="list-table-${tableId}">
      <thead>
        <tr>
          ${indexHeader}
          ${actionsHeader}
          ${headerCells}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}


function buildSearchStr(lead, columnsConfig) {
  const parts = [lead.name, lead.company, lead.phone, lead.email, lead.agent];
  columnsConfig.forEach(col => {
    if (col.isCustom) {
      parts.push(lead.customFields?.[col.rawKey] ?? '');
    }
  });
  return parts.join(' ').toLowerCase();
}

function filterTable(query, leads) {
  const rows = document.querySelectorAll('#list-table-active .list-row');
  let visible = 0;
  rows.forEach(row => {
    const match = !query || (row.dataset.search || '').includes(query);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const label = document.getElementById('list-count-label');
  if (label) label.textContent = `${visible} prospectos${query ? ` que coinciden con "${query}"` : ''}`;
}

function wireTable(leads, containerId, isArchived) {
  const tableId = isArchived ? 'archived' : 'active';
  const table = document.getElementById(`list-table-${tableId}`);
  if (!table) return;

  // Inline edit on editable cells (double-click)
  table.querySelectorAll('.list-td-editable').forEach(td => {
    const leadId  = td.dataset.leadid;
    const lead    = leads.find(l => l.id === leadId);
    if (!lead) return;
    const isCustom = td.dataset.custom === '1';
    const fieldKey = td.dataset.field;
    makeEditable(td, lead, fieldKey, isCustom, fieldKey, containerId);
  });

  // Wire pipeline select click & changes
  table.querySelectorAll('.pipeline-select').forEach(select => {
    select.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    select.addEventListener('change', async (e) => {
      const leadId = select.dataset.leadid;
      const newVal = select.value;
      const lead = await getLeadById(leadId);
      if (!lead) return;
      
      const prevVal = lead.pipelineState || 'ninguno';
      lead.pipelineState = newVal;

      const prevStatus = lead.status || 'new';
      const newStatus = getStatusFromPipelineState(newVal);
      let statusUpdated = false;
      if (prevStatus !== newStatus) {
        lead.status = newStatus;
        statusUpdated = true;
        
        const statusLabels = {
          new: 'Nuevo',
          contacted: 'Contactado',
          'no-response': 'Sin Respuesta',
          'no-wasap': 'No Wasap',
          interested: 'Interesado',
          meeting: 'Reunión',
          won: 'Ganado',
          lost: 'Descartado',
          archived: 'Archivado'
        };
        const prevLabel = statusLabels[prevStatus] || prevStatus;
        const newLabel = statusLabels[newStatus] || newStatus;
        await addLog(leadId, 'system', `Estado cambiado automáticamente de "${prevLabel}" a "${newLabel}" desde la Lista.`);
      }

      let agentUpdated = false;
      if (newVal !== '') {
        const textToSearch = [
          lead.name || '',
          lead.company || '',
          lead.website || '',
          lead.socials || '',
          JSON.stringify(lead.customFields || {}),
          lead.sector || '',
          lead.entity_plural || ''
        ].join(' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        let detectedAgent = null;
        if (
          textToSearch.includes('canin') || 
          textToSearch.includes('perro') || 
          textToSearch.includes('dog') || 
          textToSearch.includes('mascota') || 
          textToSearch.includes('veterinari') ||
          textToSearch.includes('grooming') ||
          textToSearch.includes('felina') ||
          textToSearch.includes('gato')
        ) {
          detectedAgent = 'jordan';
        } else if (
          textToSearch.includes('corredur') || 
          textToSearch.includes('segur') || 
          textToSearch.includes('broker') || 
          textToSearch.includes('mutua') || 
          textToSearch.includes('ksm') ||
          textToSearch.includes('asegur') ||
          textToSearch.includes('peritaje') ||
          textToSearch.includes('asistencia')
        ) {
          detectedAgent = 'sandra';
        }

        if (!detectedAgent && (!lead.agent || lead.agent === 'unassigned')) {
          const savedActive = localStorage.getItem('gespropec_active_agents');
          if (savedActive) {
            try {
              const activeList = JSON.parse(savedActive);
              const hasJordan = activeList.includes('jordan');
              const hasSandra = activeList.includes('sandra');
              if (hasJordan && !hasSandra) {
                detectedAgent = 'jordan';
              } else if (hasSandra && !hasJordan) {
                detectedAgent = 'sandra';
              }
            } catch (errVal) {
              console.error(errVal);
            }
          }
        }

        if (detectedAgent && lead.agent !== detectedAgent) {
          const prevAgent = lead.agent || 'unassigned';
          lead.agent = detectedAgent;
          agentUpdated = true;
          await addLog(leadId, 'system', `Asignado automáticamente al agente "${detectedAgent}" (antes "${prevAgent}") por tener un estado de seguimiento activo.`);
        }
      }
      
      await updateLead(lead);
      await addLog(leadId, 'system', `Estado de seguimiento cambiado de "${prevVal}" a "${newVal || 'ninguno'}" desde la Lista.`);
      
      if (agentUpdated || statusUpdated) {
        await renderList(containerId);
      } else {
        const config = PIPELINE_STATES[newVal] || { label: 'Seleccionar...', color: '#94a3b8' };
        select.style.background = `${config.color}15`;
        select.style.color = config.color;
        select.style.borderColor = `${config.color}40`;
      }
      
      if (onListUpdatedCallback) onListUpdatedCallback();
    });
  });

  // Wire agent select click & changes
  table.querySelectorAll('.agent-select').forEach(select => {
    select.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    select.addEventListener('change', async (e) => {
      const leadId = select.dataset.leadid;
      const newVal = select.value;
      const lead = await getLeadById(leadId);
      if (!lead) return;

      const prevVal = lead.agent || 'sin asignar';
      lead.agent = newVal;

      await updateLead(lead);
      await addLog(leadId, 'system', `Agente cambiado manualmente de "${prevVal}" a "${newVal || 'sin asignar'}" desde la Lista.`);

      await renderList(containerId);
      if (onListUpdatedCallback) onListUpdatedCallback();
    });
  });

  // Wire expand messages checkbox click & changes
  table.querySelectorAll('.toggle-expand-messages-chk').forEach(chk => {
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    chk.addEventListener('change', (e) => {
      const checked = chk.checked;
      localStorage.setItem('gespropec_expand_messages', checked ? 'true' : 'false');
      
      const activeTable = document.getElementById('list-table-active');
      if (activeTable) {
        activeTable.classList.toggle('expand-messages', checked);
        const activeChk = activeTable.querySelector('.toggle-expand-messages-chk');
        if (activeChk && activeChk !== chk) activeChk.checked = checked;
      }
      const archivedTable = document.getElementById('list-table-archived');
      if (archivedTable) {
        archivedTable.classList.toggle('expand-messages', checked);
        const archivedChk = archivedTable.querySelector('.toggle-expand-messages-chk');
        if (archivedChk && archivedChk !== chk) archivedChk.checked = checked;
      }
    });
  });

  table.addEventListener('click', async (e) => {
    const waBtn = e.target.closest('.list-whatsapp-msg-btn');
    if (waBtn) {
      e.stopPropagation();
      const msg = waBtn.dataset.msg || '';
      const phone = waBtn.dataset.phone || '';
      
      try {
        await navigator.clipboard.writeText(msg);
        showToast('Mensaje copiado al portapapeles');
      } catch (err) {
        console.error('Error al copiar el mensaje:', err);
      }

      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length === 9 && (cleanPhone.startsWith('6') || cleanPhone.startsWith('7'))) {
        cleanPhone = '34' + cleanPhone;
      }
      
      const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');

      // Find the next visible row before updating and re-rendering
      let nextLeadId = null;
      const currentRow = waBtn.closest('.list-row');
      if (currentRow) {
        const tableEl = currentRow.closest('table');
        if (tableEl) {
          const allRows = [...tableEl.querySelectorAll('.list-row')];
          const visibleRows = allRows.filter(r => r.style.display !== 'none');
          const currentIndex = visibleRows.indexOf(currentRow);
          if (currentIndex !== -1 && currentIndex < visibleRows.length - 1) {
            nextLeadId = visibleRows[currentIndex + 1].dataset.id;
          }
        }
      }

      // Auto change state to "enviado" in background (to avoid popup blocker)
      const td = waBtn.closest('td');
      const leadId = td ? td.dataset.leadid : null;
      if (leadId) {
        try {
          const lead = await getLeadById(leadId);
          if (lead) {
            if (lead.pipelineState !== 'enviado') {
              const prevPipeline = lead.pipelineState || 'ninguno';
              lead.pipelineState = 'enviado';
              
              const prevStatus = lead.status || 'new';
              const newStatus = getStatusFromPipelineState('enviado'); // 'contacted'
              
              if (prevStatus !== newStatus) {
                lead.status = newStatus;
                await addLog(leadId, 'system', `Estado cambiado automáticamente a "Contactado" al enviar mensaje por WhatsApp.`);
              }
              
              await updateLead(lead);
              await addLog(leadId, 'system', `Estado de seguimiento cambiado automáticamente de "${prevPipeline}" a "enviado" al enviar mensaje por WhatsApp.`);
              
              await renderList(containerId);
              if (onListUpdatedCallback) onListUpdatedCallback();
            }

            // Scroll to the next row (whether we re-rendered or not)
            if (nextLeadId) {
              setTimeout(() => {
                const newNextRow = document.querySelector(`.list-row[data-id="${nextLeadId}"]`);
                if (newNextRow) {
                  newNextRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  
                  // Flash highlight the next row
                  newNextRow.style.transition = 'background-color 0.5s ease';
                  const originalBg = newNextRow.style.backgroundColor;
                  newNextRow.style.backgroundColor = 'rgba(124, 58, 237, 0.15)';
                  setTimeout(() => {
                    newNextRow.style.backgroundColor = originalBg;
                  }, 1500);
                }
              }, 100);
            }
          }
        } catch (dbErr) {
          console.error('Error updating status after WhatsApp click:', dbErr);
        }
      }
      return;
    }


    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const row = e.target.closest('.list-row');
      if (row && !e.target.closest('.list-td-editable') && !e.target.closest('.pipeline-select') && !e.target.closest('.list-td-actions') && onLeadClickCallback) {
        onLeadClickCallback(row.dataset.id);
      }
      return;
    }
    e.stopPropagation();
    const { action, id } = btn.dataset;

    if (action === 'edit') {
      if (onLeadClickCallback) onLeadClickCallback(id);

    } else if (action === 'transfer') {
      const target = btn.dataset.target;
      const lead = await getLeadById(id);
      if (!lead) return;
      const from = lead.agent || 'sin asignar';
      lead.agent = target;
      await updateLead(lead);
      await addLog(id, 'system', `Prospecto transferido de "${from}" a "${target}" desde la vista Lista.`);
      await renderList(containerId);
      if (onListUpdatedCallback) onListUpdatedCallback();

    } else if (action === 'archive') {
      const lead = await getLeadById(id);
      if (!lead) return;
      lead.status = 'archived';
      await updateLead(lead);
      await addLog(id, 'system', 'Prospecto archivado desde la vista Lista.');
      await renderList(containerId);
      if (onListUpdatedCallback) onListUpdatedCallback();

    } else if (action === 'restore') {
      const lead = await getLeadById(id);
      if (!lead) return;
      lead.status = 'new';
      await updateLead(lead);
      await addLog(id, 'system', 'Prospecto restaurado desde el archivo.');
      await renderList(containerId);
      if (onListUpdatedCallback) onListUpdatedCallback();

    } else if (action === 'delete') {
      const name = btn.dataset.name || id;
      showConfirmPopup(
        `¿Eliminar a <strong>"${name}"</strong> de forma permanente? Esta acción no se puede deshacer.`,
        async () => {
          await deleteLead(id);
          await renderList(containerId);
          if (onListUpdatedCallback) onListUpdatedCallback();
        }
      );
    }
  });
}

function exportToCSV(leads, columnsConfig) {
  if (leads.length === 0) { alert('No hay datos para exportar.'); return; }
  const visibleCols = columnsConfig.filter(col => col.visible !== false);
  const escape = val => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const header = visibleCols.map(c => escape(c.label)).join(',');
  const rows = leads.map(lead =>
    visibleCols.map(col => {
      if (col.key === 'syncStatus') {
        const lastSync = localStorage.getItem('gespropec_last_sync_time');
        const lastSyncTime = lastSync ? parseInt(lastSync, 10) : 0;
        const createdTime = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
        const updatedTime = lead.updatedAt ? new Date(lead.updatedAt).getTime() : 0;
        if (lastSyncTime > 0 && createdTime >= lastSyncTime) return escape('Nuevo');
        if (lastSyncTime > 0 && updatedTime >= lastSyncTime && Math.abs(updatedTime - createdTime) > 1000) return escape('Modificado');
        return escape('Sin cambios');
      }
      if (col.isCustom) return escape(lead.customFields?.[col.rawKey] ?? '');
      if (col.key === 'agent') return escape(lead.agent || 'unassigned');
      return escape(lead[col.key] ?? '');
    }).join(',')
  );
  const csvContent = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gespropec-lista-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  document.getElementById('list-toast-notification')?.remove();

  const toast = document.createElement('div');
  toast.id = 'list-toast-notification';
  toast.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translate(-50%, 20px);
    background: rgba(15, 15, 22, 0.95);
    border: 1px solid var(--accent-green, #10b981);
    color: var(--text-primary, #fff);
    padding: 12px 24px;
    border-radius: 30px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 100000;
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  toast.innerHTML = `
    <span style="color:var(--accent-green, #10b981);display:flex;align-items:center;">
      <svg style="width:16px;height:16px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
      </svg>
    </span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, 0)';
  }, 50);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 20px)';
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

const JORDAN_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LI9DNodTNW7joOf1-1Sn3v3JJ5D7qDXNHJebiytOwxs/edit?gid=1718071955#gid=1718071955';
const SANDRA_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LI9DNodTNW7joOf1-1Sn3v3JJ5D7qDXNHJebiytOwxs/edit?gid=1759813937#gid=1759813937';

export async function syncGoogleSheetsLeads() {
  try {
    const syncStartTime = Date.now() - 2000; // 2 seconds margin
    localStorage.setItem('gespropec_last_sync_time', syncStartTime.toString());

    const jordanCsv = await fetchCSV(JORDAN_SHEET_URL);
    const sandraCsv = await fetchCSV(SANDRA_SHEET_URL);

    const rowsJordan = parseCSV(jordanCsv);
    const rowsSandra = parseCSV(sandraCsv);

    if (rowsJordan.length < 2 && rowsSandra.length < 2) {
      console.warn('Google Sheets are empty or could not be loaded.');
      return { countAdded: 0, countUpdated: 0 };
    }

    let totalAdded = 0;
    let totalUpdated = 0;

    if (rowsJordan.length >= 2) {
      const { countAdded, countUpdated } = await syncSingleSheetRows(rowsJordan, 'jordan');
      totalAdded += countAdded;
      totalUpdated += countUpdated;
    }

    if (rowsSandra.length >= 2) {
      const { countAdded, countUpdated } = await syncSingleSheetRows(rowsSandra, 'sandra');
      totalAdded += countAdded;
      totalUpdated += countUpdated;
    }

    return { countAdded: totalAdded, countUpdated: totalUpdated };
  } catch (error) {
    console.error('[Sync] Google Sheets sync failed:', error);
    throw error;
  }
}

async function syncSingleSheetRows(rows, defaultAgent) {
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const mapping = autoDetectMapping(headers);

  if (mapping.name === -1) {
    console.warn(`[Sync] No name column detected for ${defaultAgent}'s sheet.`);
    return { countAdded: 0, countUpdated: 0 };
  }

  const existingLeads = await getAllLeads();
  const leadByEmail = new Map();
  const leadByName = new Map();
  existingLeads.forEach(l => {
    if (l.email) leadByEmail.set(l.email.toLowerCase().trim(), l);
    if (l.name) leadByName.set(l.name.toLowerCase().trim(), l);
  });

  let countAdded = 0;
  let countUpdated = 0;

  for (const row of dataRows) {
    const getVal = (field) => {
      const idx = mapping[field];
      return (idx !== undefined && idx !== -1 && idx < row.length) ? row[idx].trim() : '';
    };

    const name = getVal('name');
    if (!name) continue;

    const email = getVal('email');
    const phone = getVal('phone');
    const company = getVal('company');
    const website = getVal('website');
    const socials = getVal('socials');
    const initialNotes = getVal('notes');

    const customFields = {};
    headers.forEach((h, idx) => {
      if (idx < row.length && h) {
        customFields[h] = row[idx].trim();
      }
    });

    const emailKey = email ? email.toLowerCase().trim() : '';
    const nameKey = name.toLowerCase().trim();

    let existingLead = null;
    if (emailKey && leadByEmail.has(emailKey)) {
      existingLead = leadByEmail.get(emailKey);
    } else if (leadByName.has(nameKey)) {
      existingLead = leadByName.get(nameKey);
    }

    if (existingLead) {
      let changed = false;
      
      if (company && existingLead.company !== company) { existingLead.company = company; changed = true; }
      if (phone && existingLead.phone !== phone) { existingLead.phone = phone; changed = true; }
      if (website && existingLead.website !== website) { existingLead.website = website; changed = true; }
      if (socials && existingLead.socials !== socials) { existingLead.socials = socials; changed = true; }
      
      existingLead.customFields = existingLead.customFields || {};
      for (const [k, v] of Object.entries(customFields)) {
        if (v && existingLead.customFields[k] !== v) {
          existingLead.customFields[k] = v;
          changed = true;
        }
      }

      if (changed) {
        existingLead.updatedAt = new Date().toISOString();
        await updateLead(existingLead);
        countUpdated++;
      }
    } else {
      const newLead = {
        id: 'lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        name,
        email,
        phone,
        company,
        website,
        socials,
        agent: defaultAgent,
        customFields,
        status: 'new'
      };

      await addLead(newLead);
      await addLog(newLead.id, 'system', `Creado automáticamente por sincronización con Google Sheets (${defaultAgent}).`);
      if (initialNotes) {
        await addLog(newLead.id, 'note', `Nota importada: "${initialNotes}"`);
      }
      countAdded++;
    }
  }

  return { countAdded, countUpdated };
}

/* ==========================================================================
   COLUMN RESIZING SYSTEM
   ========================================================================== */
function initColumnResizing(table) {
  const headers = table.querySelectorAll('th.list-th');
  headers.forEach(th => {
    if (th.querySelector('.col-resize-handle')) return;

    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    th.appendChild(handle);

    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Lock all header widths to their current actual offsetWidth
      const allHeaders = table.querySelectorAll('th.list-th');
      allHeaders.forEach(header => {
        if (!header.style.width) {
          const currentWidth = header.offsetWidth;
          header.style.width = `${currentWidth}px`;
          header.style.minWidth = `${currentWidth}px`;
        }
      });

      startX = e.pageX;
      startWidth = th.offsetWidth;

      handle.classList.add('resizing');
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (moveEvent) => {
        const diffX = moveEvent.pageX - startX;
        const newWidth = Math.max(40, startWidth + diffX);
        th.style.width = `${newWidth}px`;
        th.style.minWidth = `${newWidth}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        handle.classList.remove('resizing');
        document.body.style.cursor = '';

        const colKey = th.dataset.colKey;
        if (colKey) {
          const savedWidths = JSON.parse(localStorage.getItem('gespropec_column_widths') || '{}');
          savedWidths[colKey] = th.offsetWidth;
          localStorage.setItem('gespropec_column_widths', JSON.stringify(savedWidths));
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);
  });
}

