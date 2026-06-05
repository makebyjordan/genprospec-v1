import { getLeadsFilteredByAgent, getLeadById, updateLead, deleteLead, addLog, getDefaultPipelineStateFromStatus } from '../db.js';

// Status configurations
export const STAGES = {
  new: { label: 'Nuevos', class: 'col-new' },
  contacted: { label: 'Contactados', class: 'col-contacted' },
  'no-response': { label: 'Sin Respuesta', class: 'col-no-response' },
  'no-wasap': { label: 'No Wasap', class: 'col-no-wasap' },
  interested: { label: 'Interesados', class: 'col-interested' },
  meeting: { label: 'Reunión Agendada', class: 'col-meeting' },
  won: { label: 'Clientes Ganados', class: 'col-won' },
  lost: { label: 'Descartados', class: 'col-lost' }
};

let onLeadClickCallback = null;
let onBoardUpdatedCallback = null;
let _containerId = null;

export function initBoard(onLeadClick, onBoardUpdated) {
  onLeadClickCallback = onLeadClick;
  onBoardUpdatedCallback = onBoardUpdated;
}

// Close all open context menus
function closeAllMenus() {
  document.querySelectorAll('.card-context-menu').forEach(m => m.remove());
}

// Show context menu next to a card's dots button
function showCardMenu(dotsEl, lead, containerId) {
  closeAllMenus();

  const menu = document.createElement('div');
  menu.className = 'card-context-menu';
  menu.innerHTML = `
    <button data-action="archive">
      <svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"/>
      </svg>
      Archivar
    </button>
    <div class="menu-sep"></div>
    <button data-action="delete" class="danger">
      <svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2"/>
      </svg>
      Eliminar
    </button>
  `;

  dotsEl.appendChild(menu);

  // Archive action
  menu.querySelector('[data-action="archive"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAllMenus();
    const full = await getLeadById(lead.id);
    if (!full) return;
    const prevStatus = full.status;
    full.status = 'archived';
    await updateLead(full);
    await addLog(full.id, 'system', `Prospecto archivado (estaba en "${STAGES[prevStatus]?.label || prevStatus}").`);
    renderBoard(containerId);
    if (onBoardUpdatedCallback) onBoardUpdatedCallback();
  });

  // Delete action
  menu.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAllMenus();
    const confirmed = confirm(`¿Eliminar a "${lead.name}" de forma permanente? Esta acción no se puede deshacer.`);
    if (!confirmed) return;
    await deleteLead(lead.id);
    renderBoard(containerId);
    if (onBoardUpdatedCallback) onBoardUpdatedCallback();
  });

  // Close on outside click
  const outsideClick = (e) => {
    if (!menu.contains(e.target)) {
      closeAllMenus();
      document.removeEventListener('click', outsideClick, true);
    }
  };
  setTimeout(() => document.addEventListener('click', outsideClick, true), 0);
}

export async function renderBoard(containerId) {
  _containerId = containerId;
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<div class="notifications-empty">Cargando tablero...</div>';

  try {
    const allLeads = await getLeadsFilteredByAgent();

    const activeLeads = allLeads.filter(l => l.status !== 'archived');
    const archivedLeads = allLeads.filter(l => l.status === 'archived');

    // Group active leads by status
    const grouped = {};
    Object.keys(STAGES).forEach(status => { grouped[status] = []; });
    activeLeads.forEach(lead => {
      const status = lead.status || 'new';
      if (grouped[status]) {
        grouped[status].push(lead);
      } else {
        grouped['new'].push(lead);
      }
    });

    // Group archived by their previous stage (we just show them all in one pool per column if needed)
    // For simplicity: show archived at the very bottom of the board in a collapsible strip
    container.innerHTML = '';
    container.className = 'kanban-container';

    Object.entries(STAGES).forEach(([statusKey, stageInfo]) => {
      const columnLeads = grouped[statusKey] || [];

      const columnEl = document.createElement('div');
      columnEl.className = `kanban-column ${stageInfo.class}`;
      columnEl.dataset.status = statusKey;

      columnEl.innerHTML = `
        <div class="kanban-column-header">
          <div class="column-title-group">
            <span class="column-dot"></span>
            <h3 class="column-title">${stageInfo.label}</h3>
          </div>
          <span class="column-badge" id="badge-${statusKey}">${columnLeads.length}</span>
        </div>
        <div class="kanban-cards-wrapper" id="cards-wrap-${statusKey}"></div>
      `;

      container.appendChild(columnEl);

      const cardsWrap = columnEl.querySelector('.kanban-cards-wrapper');

      if (columnLeads.length === 0) {
        cardsWrap.innerHTML = `
          <div style="font-size: 11px; color: var(--text-muted); text-align: center; margin: auto; padding: 20px 0; font-style: italic;">
            Arrastra leads aquí
          </div>
        `;
      } else {
        columnLeads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).forEach(lead => {
          cardsWrap.appendChild(buildCard(lead, containerId));
        });
      }

      // Drag and Drop
      cardsWrap.addEventListener('dragover', (e) => {
        e.preventDefault();
        cardsWrap.classList.add('drag-over');
      });
      cardsWrap.addEventListener('dragleave', () => {
        cardsWrap.classList.remove('drag-over');
      });
      cardsWrap.addEventListener('drop', async (e) => {
        e.preventDefault();
        cardsWrap.classList.remove('drag-over');
        const draggedCard = document.querySelector('.dragging');
        if (!draggedCard) return;
        const leadId = draggedCard.dataset.id;
        const newStatus = columnEl.dataset.status;
        const lead = await getLeadById(leadId);
        if (lead && lead.status !== newStatus) {
          const oldStatusName = STAGES[lead.status]?.label || lead.status;
          const newStatusName = STAGES[newStatus]?.label;
          lead.status = newStatus;
          
          // Sincronizar el pipelineState
          const prevPipeline = lead.pipelineState || '';
          const newPipeline = getDefaultPipelineStateFromStatus(newStatus);
          if (prevPipeline !== newPipeline) {
            lead.pipelineState = newPipeline;
            
            const pipelineLabels = {
              'enviado': 'Enviado',
              'contestado': 'Contestado',
              'no contesta': 'No contesta',
              'pide info': 'Pide info',
              'cuanto cuesta': 'Cuánto cuesta',
              'podemos quedar': 'Podemos quedar',
              'mas info': 'Más info',
              'cita': 'Cita',
              'envio demo': 'Envío demo',
              'llamar': 'Llamar',
              'presupuesto': 'Presupuesto',
              'firmado': 'Firmado',
              'haciendo': 'Haciendo',
              'cobro parcial': 'Cobro parcial',
              'cobro total': 'Cobro total',
              'implementado': 'Implementado',
              'con mensualidad': 'Con mensualidad',
              'finalizado': 'Finalizado',
              'descartado': 'Descartado',
              'no_wasap': 'No Wasap',
              '': 'ninguno'
            };
            const prevLabel = pipelineLabels[prevPipeline] || prevPipeline || 'ninguno';
            const newLabel = pipelineLabels[newPipeline] || newPipeline || 'ninguno';
            await addLog(lead.id, 'system', `Fase de seguimiento cambiada automáticamente de "${prevLabel}" a "${newLabel}" al arrastrar en el Kanban.`);
          }

          await updateLead(lead);
          await addLog(lead.id, 'system', `Estado cambiado de "${oldStatusName}" a "${newStatusName}"`);
          renderBoard(containerId);
          if (onBoardUpdatedCallback) onBoardUpdatedCallback();
        }
      });
    });

    // ── Archived leads section ───────────────────────────────────────────
    if (archivedLeads.length > 0) {
      const archiveSection = document.createElement('div');
      archiveSection.className = 'kanban-column';
      archiveSection.style.cssText = `
        border: 1px dashed rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.02);
        min-width: 200px;
      `;
      archiveSection.innerHTML = `
        <div class="kanban-column-header" style="cursor:pointer" id="archive-col-header">
          <div class="column-title-group">
            <svg style="width:14px;height:14px;color:var(--text-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8"/>
            </svg>
            <h3 class="column-title" style="color:var(--text-muted)">Archivados</h3>
          </div>
          <span class="column-badge" style="background:rgba(255,255,255,0.06);color:var(--text-muted)">${archivedLeads.length}</span>
        </div>
        <div id="archive-cards-wrap" style="display:none;"></div>
      `;
      container.appendChild(archiveSection);

      const archiveWrap = archiveSection.querySelector('#archive-cards-wrap');
      const archiveHeader = archiveSection.querySelector('#archive-col-header');

      archivedLeads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).forEach(lead => {
        const card = buildArchivedCard(lead, containerId);
        archiveWrap.appendChild(card);
      });

      // Toggle collapsed/expanded
      archiveHeader.addEventListener('click', () => {
        const isOpen = archiveWrap.style.display !== 'none';
        archiveWrap.style.display = isOpen ? 'none' : 'block';
      });
    }

  } catch (error) {
    console.error('Error rendering Kanban board:', error);
    container.innerHTML = '<div class="notifications-empty" style="color:var(--accent-red)">Error al cargar el tablero de control.</div>';
  }
}

function buildCard(lead, containerId) {
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.draggable = true;
  card.dataset.id = lead.id;

  let tagsHtml = '';
  if (lead.phone) tagsHtml += `<span class="tag tag-whatsapp">WhatsApp</span>`;
  if (lead.email) tagsHtml += `<span class="tag tag-email">Email</span>`;
  if (lead.phone && lead.email) tagsHtml += `<span class="tag tag-phone">Llamada</span>`;

  const dateStr = new Date(lead.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  card.innerHTML = `
    ${lead.company ? `<div class="card-lead-company">${lead.company}</div>` : ''}
    <div class="card-lead-name">${lead.name}</div>
    ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
    <div class="card-footer">
      <span class="card-date">
        <svg class="menu-icon" style="width:12px;height:12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        ${dateStr}
      </span>
      <div class="card-actions-dots" title="Opciones">
        <svg style="width:14px;height:14px;" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </div>
    </div>
  `;

  // Dots button opens context menu
  const dotsBtn = card.querySelector('.card-actions-dots');
  dotsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showCardMenu(dotsBtn, lead, containerId);
  });

  // Card click opens modal (ignore dots)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-actions-dots')) return;
    if (onLeadClickCallback) onLeadClickCallback(lead.id);
  });

  card.addEventListener('dragstart', () => card.classList.add('dragging'));
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  return card;
}

function buildArchivedCard(lead, containerId) {
  const card = document.createElement('div');
  card.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 6px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    gap: 8px;
  `;

  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-size:13px;color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
  nameEl.textContent = lead.name;
  nameEl.title = lead.name + (lead.company ? ` — ${lead.company}` : '');
  nameEl.addEventListener('click', () => { if (onLeadClickCallback) onLeadClickCallback(lead.id); });

  // Restore button
  const restoreBtn = document.createElement('button');
  restoreBtn.title = 'Restaurar al tablero';
  restoreBtn.style.cssText = `
    background: none; border: none; cursor: pointer; color: var(--text-muted);
    padding: 3px 5px; border-radius: 4px; font-size: 11px; display:flex; align-items:center; gap:4px;
    transition: color 0.15s, background 0.15s;
  `;
  restoreBtn.innerHTML = `
    <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
    </svg>
    Restaurar
  `;
  restoreBtn.addEventListener('mouseenter', () => { restoreBtn.style.color = '#a78bfa'; restoreBtn.style.background = 'rgba(167,139,250,0.1)'; });
  restoreBtn.addEventListener('mouseleave', () => { restoreBtn.style.color = 'var(--text-muted)'; restoreBtn.style.background = 'none'; });
  restoreBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const full = await getLeadById(lead.id);
    if (!full) return;
    full.status = 'new';
    full.pipelineState = '';
    await updateLead(full);
    await addLog(full.id, 'system', 'Prospecto restaurado desde el archivo.');
    renderBoard(containerId);
    if (onBoardUpdatedCallback) onBoardUpdatedCallback();
  });

  // Delete permanently button
  const delBtn = document.createElement('button');
  delBtn.title = 'Eliminar permanentemente';
  delBtn.style.cssText = `
    background: none; border: none; cursor: pointer; color: var(--text-muted);
    padding: 3px 5px; border-radius: 4px; transition: color 0.15s, background 0.15s;
  `;
  delBtn.innerHTML = `
    <svg style="width:13px;height:13px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2"/>
    </svg>
  `;
  delBtn.addEventListener('mouseenter', () => { delBtn.style.color = '#f87171'; delBtn.style.background = 'rgba(239,68,68,0.1)'; });
  delBtn.addEventListener('mouseleave', () => { delBtn.style.color = 'var(--text-muted)'; delBtn.style.background = 'none'; });
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const confirmed = confirm(`¿Eliminar a "${lead.name}" de forma permanente?`);
    if (!confirmed) return;
    await deleteLead(lead.id);
    renderBoard(containerId);
    if (onBoardUpdatedCallback) onBoardUpdatedCallback();
  });

  card.appendChild(nameEl);
  card.appendChild(restoreBtn);
  card.appendChild(delBtn);

  return card;
}
