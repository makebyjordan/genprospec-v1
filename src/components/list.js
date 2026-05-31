import { getLeadsFilteredByAgent, getAllLeads, getLeadById, updateLead, deleteLead, addLog } from '../db.js';

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

function statusBadge(status) {
  const map = {
    new:            { label: 'Nuevo',        color: '#818cf8' },
    contacted:      { label: 'Contactado',   color: '#34d399' },
    'no-response':  { label: 'Sin Respuesta',color: '#f59e0b' },
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
  if (agent === 'jordan') return 'sandra';
  if (agent === 'sandra') return 'jordan';
  return null;
}

function otherAgentLabel(agent) {
  if (agent === 'jordan') return 'Enviar a Sandra';
  if (agent === 'sandra') return 'Enviar a Jordan';
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

export async function renderList(containerId) {
  _containerId = containerId;
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="notifications-empty" style="padding:40px">Cargando lista...</div>';

  try {
    const leads = await getLeadsFilteredByAgent();
    const active   = leads.filter(l => l.status !== 'archived');
    const archived = leads.filter(l => l.status === 'archived');
    const customKeys = collectCustomFieldKeys(leads);

    const standardCols = [
      { key: 'name',    label: 'Nombre' },
      { key: 'company', label: 'Empresa' },
      { key: 'phone',   label: 'Teléfono' },
      { key: 'email',   label: 'Correo' },
      { key: 'website', label: 'Web' },
      { key: 'status',  label: 'Estado' },
      { key: 'agent',   label: 'Agente' },
    ];

    let activeAgents = ['jordan', 'sandra', 'unassigned'];
    try {
      const saved = localStorage.getItem('gespropec_active_agents');
      if (saved) activeAgents = JSON.parse(saved);
    } catch(e) {}

    const agentLabel = activeAgents.length === 1
      ? (activeAgents[0] === 'jordan' ? '— Jordan García'
       : activeAgents[0] === 'sandra' ? '— Sandra Delgado' : '')
      : '';

    container.innerHTML = `
      <div class="list-toolbar">
        <div class="list-search-wrap">
          <svg style="width:15px;height:15px;color:var(--text-muted);flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" id="list-search-input" class="list-search-input" placeholder="Buscar por nombre, empresa, teléfono…">
        </div>
        <div class="list-toolbar-right">
          <span class="list-count-label" id="list-count-label">${active.length} prospectos ${agentLabel}</span>
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
        ${buildTableHTML(active, standardCols, customKeys, 'active')}
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
          ${buildTableHTML(archived, standardCols, customKeys, 'archived')}
        </div>
      ` : ''}
    `;

    // Wire search
    document.getElementById('list-search-input')?.addEventListener('input', (e) => {
      filterTable(e.target.value.toLowerCase(), active);
    });

    // Wire export
    document.getElementById('list-export-csv-btn')?.addEventListener('click', () => {
      exportToCSV(active, standardCols, customKeys);
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
    wireTable(active, standardCols, customKeys, containerId, false);
    wireTable(archived, standardCols, customKeys, containerId, true);

  } catch (err) {
    console.error('Error rendering list:', err);
    container.innerHTML = '<div class="notifications-empty" style="color:var(--accent-red)">Error al cargar la lista.</div>';
  }
}

function buildTableHTML(leads, standardCols, customKeys, tableId) {
  const allCols = [
    ...standardCols,
    ...customKeys.map(k => ({ key: `cf_${k}`, label: k, isCustom: true, rawKey: k }))
  ];

  if (leads.length === 0) {
    return `<div class="list-empty">
      <svg style="width:40px;height:40px;color:var(--text-muted);margin-bottom:12px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
      <p>No hay prospectos para mostrar</p>
    </div>`;
  }

  const headerCells = allCols.map(col =>
    `<th class="list-th">${col.label}</th>`
  ).join('');

  const rows = leads.map(lead => {
    const other = otherAgent(lead.agent);
    const otherLabel = otherAgentLabel(lead.agent);

    const cells = allCols.map(col => {
      if (col.key === 'status') {
        return `<td class="list-td list-td-nobold">${statusBadge(lead.status)}</td>`;
      }
      if (col.key === 'agent') {
        return `<td class="list-td list-td-nobold">${agentBadge(lead.agent)}</td>`;
      }
      if (col.key === 'website' && lead[col.key]) {
        return `<td class="list-td list-td-nobold" title="${lead[col.key]}">
          <a href="${lead[col.key]}" target="_blank" class="list-link">${lead[col.key]}</a>
        </td>`;
      }
      const val = col.isCustom
        ? (lead.customFields?.[col.rawKey] ?? '')
        : (lead[col.key] ?? '');
      const isEditable = col.key !== 'status' && col.key !== 'agent';
      return `<td class="list-td${col.key === 'name' ? '' : ' list-td-nobold'}${isEditable ? ' list-td-editable' : ''}"
        data-field="${col.isCustom ? col.rawKey : col.key}"
        data-custom="${col.isCustom ? '1' : '0'}"
        data-leadid="${lead.id}"
        title="${String(val).replace(/"/g, '&quot;')}"
      >${val || '<span class="list-empty-cell">—</span>'}</td>`;
    }).join('');

    return `
      <tr class="list-row" data-id="${lead.id}" data-agent="${lead.agent || ''}" data-search="${buildSearchStr(lead, customKeys)}">
        ${cells}
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
      </tr>
    `;
  }).join('');

  return `
    <table class="list-table" id="list-table-${tableId}">
      <thead>
        <tr>${headerCells}<th class="list-th list-th-actions">Acciones</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildSearchStr(lead, customKeys) {
  const parts = [lead.name, lead.company, lead.phone, lead.email, lead.agent];
  customKeys.forEach(k => parts.push(lead.customFields?.[k] ?? ''));
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

function wireTable(leads, standardCols, customKeys, containerId, isArchived) {
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

  // Row button actions
  table.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      // Row click = open detail
      const row = e.target.closest('.list-row');
      if (row && !e.target.closest('.list-td-editable') && onLeadClickCallback) {
        onLeadClickCallback(row.dataset.id);
      }
      return;
    }
    e.stopPropagation();
    const { action, id } = btn.dataset;

    if (action === 'edit') {
      if (onLeadClickCallback) onLeadClickCallback(id);

    } else if (action === 'transfer') {
      const target = btn.dataset.target; // 'jordan' or 'sandra'
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

function exportToCSV(leads, standardCols, customKeys) {
  if (leads.length === 0) { alert('No hay datos para exportar.'); return; }
  const allCols = [
    ...standardCols,
    ...customKeys.map(k => ({ key: `cf_${k}`, label: k, isCustom: true, rawKey: k }))
  ];
  const escape = val => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const header = allCols.map(c => escape(c.label)).join(',');
  const rows = leads.map(lead =>
    allCols.map(col => {
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
