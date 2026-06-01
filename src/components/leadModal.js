import { 
  getLeadById, 
  updateLead, 
  deleteLead, 
  getLogsForLead, 
  addLog, 
  getRemindersForLead, 
  addReminder, 
  updateReminder, 
  deleteReminder 
} from '../db.js';
import { STAGES } from './board.js';
import { PIPELINE_STATES } from './list.js';
import { TEMPLATES, SENDER_DEFAULTS, SECTOR_PRESETS, getDynamicGreetingVars } from '../templates.js';

let currentLeadId = null;
let currentLead = null;
let onLeadChangedCallback = null;

// Helper to extract location from custom fields
function getLeadLocation(lead) {
  if (!lead) return '';
  if (lead.location) return lead.location;
  if (lead.customFields) {
    const keys = Object.keys(lead.customFields);
    for (const key of keys) {
      const norm = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (norm.includes('ciudad') || norm.includes('provincia') || norm.includes('localidad') || norm.includes('barrio') || norm.includes('pueblo')) {
        if (lead.customFields[key]) return lead.customFields[key];
      }
    }
    for (const key of keys) {
      const norm = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (norm.includes('comunidad') || norm.includes('region')) {
        if (lead.customFields[key]) return lead.customFields[key];
      }
    }
  }
  return '';
}

// Helper to extract entity plural from custom fields or sector
function getLeadEntityPlural(lead) {
  if (!lead) return 'clientes';
  if (lead.entity_plural) return lead.entity_plural;
  const sector = (lead.sector || '').toLowerCase();
  if (sector.includes('canin') || sector.includes('perro') || sector.includes('mascota')) return 'perros';
  if (sector.includes('taller') || sector.includes('mecanic') || sector.includes('coche') || sector.includes('vehiculo')) return 'coches';
  if (sector.includes('estetica') || sector.includes('peluqueria') || sector.includes('salon')) return 'clientes';
  if (sector.includes('clinica') || sector.includes('fisioterap') || sector.includes('medico') || sector.includes('paciente')) return 'pacientes';
  if (sector.includes('inmobiliari') || sector.includes('piso') || sector.includes('inmueble')) return 'inmuebles';
  
  if (lead.customFields) {
    const keys = Object.keys(lead.customFields);
    for (const key of keys) {
      const norm = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (norm.includes('sector') || norm.includes('actividad')) {
        const val = lead.customFields[key].toLowerCase();
        if (val.includes('canin') || val.includes('perro') || val.includes('mascota')) return 'perros';
        if (val.includes('taller') || val.includes('mecanic') || val.includes('coche') || val.includes('vehiculo')) return 'coches';
        if (val.includes('estetica') || val.includes('peluqueria') || val.includes('salon')) return 'clientes';
        if (val.includes('clinica') || val.includes('fisioterap') || val.includes('medico') || val.includes('paciente')) return 'pacientes';
        if (val.includes('inmobiliari') || val.includes('piso') || val.includes('inmueble')) return 'inmuebles';
      }
    }
  }
  return 'clientes';
}

// Smart field resolver for templates
function resolveFieldValue(fieldId, templateId) {
  if (!currentLead) return '';

  if (currentLead[fieldId] !== undefined && currentLead[fieldId] !== '') {
    return currentLead[fieldId];
  }

  if (fieldId === 'location') {
    const loc = getLeadLocation(currentLead);
    if (loc) return loc;
  }

  if (fieldId === 'entity_plural') {
    return getLeadEntityPlural(currentLead);
  }

  if (currentLead.customFields) {
    if (currentLead.customFields[fieldId] !== undefined && currentLead.customFields[fieldId] !== '') {
      return currentLead.customFields[fieldId];
    }
    const keys = Object.keys(currentLead.customFields);
    for (const key of keys) {
      const normKey = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const normFieldId = fieldId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (normKey === normFieldId || normKey.includes(normFieldId) || normFieldId.includes(normKey)) {
        if (currentLead.customFields[key] !== undefined && currentLead.customFields[key] !== '') {
          return currentLead.customFields[key];
        }
      }
    }
  }

  const savedValKey = `pitch_field_${templateId}_${fieldId}`;
  const stored = localStorage.getItem(savedValKey);
  if (stored !== null && stored !== '') return stored;

  const template = TEMPLATES.find(t => t.id === templateId);
  const field = template?.fields.find(f => f.id === fieldId);
  return field?.default || '';
}

// Initialize modal hooks
export function initLeadModal(onLeadChanged) {
  onLeadChangedCallback = onLeadChanged;
  setupModalDOM();
}

// Write Modal HTML structure to document body if it doesn't exist
function setupModalDOM() {
  if (document.getElementById('lead-drawer-backdrop')) return;

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'lead-drawer-backdrop';
  backdrop.className = 'drawer-backdrop';

  // Drawer Panel
  const drawer = document.createElement('div');
  drawer.id = 'lead-drawer';
  drawer.className = 'drawer';
  
  drawer.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-title-group">
        <span id="drawer-lead-company" class="card-lead-company" style="font-size: 12px; margin-bottom: 2px;">EMPRESA</span>
        <h2 id="drawer-lead-name" class="drawer-title">Nombre del Lead</h2>
      </div>
      <button class="drawer-close" id="btn-close-drawer">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    
    <div class="tabs-header" style="padding: 0 24px;">
      <button class="tab-btn active" data-tab="tab-info">Información</button>
      <button class="tab-btn" data-tab="tab-history">Historial & Notas</button>
      <button class="tab-btn" data-tab="tab-tasks">Agenda</button>
    </div>
    
    <div class="drawer-body">
      <!-- TAB 1: INFO -->
      <div class="tab-pane active" id="tab-info">
        <form id="form-edit-lead">
          <div class="form-group">
            <label class="form-label">Nombre del Contacto *</label>
            <input type="text" id="edit-name" class="input-field" required>
          </div>
          <div class="form-group">
            <label class="form-label">Empresa</label>
            <input type="text" id="edit-company" class="input-field">
          </div>
          <div class="form-group">
            <label class="form-label">Correo Electrónico</label>
            <input type="email" id="edit-email" class="input-field">
          </div>
          <div class="form-group">
            <label class="form-label">Teléfono / WhatsApp</label>
            <input type="text" id="edit-phone" class="input-field" placeholder="Ej: +34 600 000 000">
          </div>
          <div class="form-group">
            <label class="form-label">Sitio Web (URL)</label>
            <input type="text" id="edit-website" class="input-field" placeholder="https://ejemplo.com">
          </div>
          <div class="form-group">
            <label class="form-label">Redes Sociales / Instagram</label>
            <input type="text" id="edit-socials" class="input-field" placeholder="@usuario o link">
          </div>
          <div class="form-group">
            <label class="form-label">Fase de Seguimiento (Lista)</label>
            <select id="edit-pipeline-state" class="input-field" style="background-color: var(--bg-surface);">
              <option value="">-- Ninguno --</option>
              ${Object.entries(PIPELINE_STATES).map(([key, val]) => `<option value="${key}">${val.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Estado de Seguimiento</label>
            <select id="edit-status" class="input-field" style="background-color: var(--bg-surface);">
              ${Object.entries(STAGES).map(([key, val]) => `<option value="${key}">${val.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Agente Asignado</label>
            <select id="edit-agent" class="input-field" style="background-color: var(--bg-surface);">
              <option value="unassigned">Sin Asignar</option>
              <option value="jordan">Jordan García</option>
              <option value="sandra">Sandra Delgado</option>
            </select>
          </div>
          
          <!-- CUSTOM FIELDS DYNAMIC SECTION -->
          <div id="custom-fields-section" style="border-top: 1px solid var(--border-color); margin-top: 24px; padding-top: 24px; display: none;">
            <h4 style="font-family: var(--font-heading); font-size: 14px; margin-bottom: 12px; color: var(--text-primary); display: flex; align-items: center; justify-content: space-between;">
              <span style="display: flex; align-items: center; gap: 8px;">📊 Datos Adicionales / Excel</span>
              <button type="button" id="btn-add-custom-field" class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; margin: 0; width: auto; height: auto;">➕ Añadir Campo</button>
            </h4>
            <div id="custom-fields-container" style="display: flex; flex-direction: column; gap: 12px;"></div>
          </div>
          
          <div style="display: flex; gap: 12px; margin-top: 32px;">
            <button type="submit" class="btn btn-primary" style="flex-grow: 1;">Guardar Cambios</button>
            <button type="button" id="btn-delete-lead" class="btn btn-secondary" style="color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);">
              Eliminar Lead
            </button>
          </div>
        </form>
      </div>
      
      <!-- TAB 2: HISTORY -->
      <div class="tab-pane" id="tab-history">
        <div class="quick-log-grid">
          <button class="btn btn-log-action note" data-type="note">
            <span>📝</span>Nota
          </button>
          <button class="btn btn-log-action call" data-type="call">
            <span>📞</span>Llamar
          </button>
          <button class="btn btn-log-action whatsapp" data-type="whatsapp">
            <span>💬</span>WhatsApp
          </button>
          <button class="btn btn-log-action email" data-type="email">
            <span>✉️</span>Email
          </button>
        </div>
        
        <div class="glass-card" style="padding: 16px; margin-bottom: 24px;">
          <h4 style="font-size: 14px; margin-bottom: 8px;" id="activity-composer-title">Añadir Nota Rápida</h4>
          <textarea id="activity-content" class="input-field" rows="3" placeholder="Escribe detalles sobre la llamada, propuesta, respuestas..." style="resize: none;"></textarea>
          
          <!-- PITCH GENERATOR EXPANDED PANEL -->
          <div id="pitch-generator-panel" style="display: none; border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 16px; flex-direction: column; gap: 12px;">
            <div class="form-group" style="margin-bottom: 8px;">
              <label class="form-label" style="font-size: 12px; margin-bottom: 4px;">Selecciona una Plantilla de Gancho</label>
              <select id="pitch-template-select" class="input-field" style="background-color: var(--bg-surface); padding: 8px 12px; font-size:13px;"></select>
            </div>
            
            <div id="pitch-dynamic-fields" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px;">
              <!-- Dynamic hook variables will go here -->
            </div>

            <!-- SENDER SETTINGS ACCORDION -->
            <details style="font-size: 12px; color: var(--text-secondary); cursor: pointer; margin-bottom: 4px;" id="pitch-sender-details">
              <summary style="font-weight: 600; margin-bottom: 6px; user-select: none;">🔧 Configurar Datos de Remitente</summary>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.05); margin-top: 4px;">
                <div class="form-group" style="margin-bottom: 8px;">
                  <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">Mi Nombre</label>
                  <input type="text" id="pitch-sender" class="input-field" style="padding: 6px 10px; font-size:11px;">
                </div>
                <div class="form-group" style="margin-bottom: 8px;">
                  <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">Mi Empresa</label>
                  <input type="text" id="pitch-agency" class="input-field" style="padding: 6px 10px; font-size:11px;">
                </div>
                <div class="form-group" style="margin-bottom: 8px; grid-column: span 2;">
                  <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">Mi Web (URL)</label>
                  <input type="text" id="pitch-url" class="input-field" style="padding: 6px 10px; font-size:11px;">
                </div>
                <div class="form-group" style="margin-bottom: 8px; grid-column: span 2;">
                  <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">Sector Objetivo</label>
                  <select id="pitch-sector-select" class="input-field" style="background-color: var(--bg-surface); padding: 6px 10px; font-size:11px; margin-bottom: 6px;">
                    <option value="peluquerías caninas">Peluquería Canina</option>
                    <option value="talleres mecánicos">Taller Mecánico</option>
                    <option value="peluquerías y estética">Estética / Peluquería</option>
                    <option value="clínicas y fisioterapia">Clínica / Fisioterapia</option>
                    <option value="inmobiliarias">Inmobiliaria</option>
                    <option value="custom">Otro (Especificar abajo)</option>
                  </select>
                  <input type="text" id="pitch-sector" class="input-field" style="padding: 6px 10px; font-size:11px; display: none;" placeholder="Especifica el nombre del sector...">
                </div>
                <div class="form-group" style="margin-bottom: 8px; grid-column: span 2;">
                  <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">Características / Propuesta CRM</label>
                  <textarea id="pitch-features" class="input-field" rows="2" style="padding: 6px 10px; font-size:11px; resize:none;"></textarea>
                </div>
              </div>
            </details>
          </div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px;">
            <span id="quick-action-link" style="font-size: 12px;"></span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" id="btn-ai-analyze-web" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; display: none; color: var(--accent-green); border-color: rgba(16, 185, 129, 0.3); align-items: center; gap: 6px;">
                🤖 Analizar Web con IA
              </button>
              <button type="button" id="btn-generate-pitch" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px; display: none; color: var(--accent-purple); border-color: rgba(124, 58, 237, 0.3);">
                ✨ Redactar Gancho
              </button>
              <button type="button" id="btn-save-activity" class="btn btn-primary" style="padding: 6px 14px; font-size: 12px;">Registrar</button>
            </div>
          </div>
        </div>

        <h4 style="font-family: var(--font-heading); font-size: 15px; margin-bottom: 12px;">Línea de Tiempo de Interacciones</h4>
        <div class="timeline" id="lead-timeline">
          <!-- Timelines go here -->
        </div>
      </div>
      
      <!-- TAB 3: TASKS/CALENDAR -->
      <div class="tab-pane" id="tab-tasks">
        <form id="form-add-reminder" class="glass-card" style="padding: 16px; margin-bottom: 24px;">
          <h4 style="font-family: var(--font-heading); font-size: 14px; margin-bottom: 12px;">Programar Próxima Acción</h4>
          <div class="form-group" style="margin-bottom: 12px;">
            <label class="form-label" style="font-size: 12px; margin-bottom: 4px;">Acción Pendiente</label>
            <input type="text" id="task-title" class="input-field" placeholder="Ej: Enviar presupuesto final, Llamar a validar..." required>
          </div>
          <div class="grid-cols-2" style="gap: 12px; margin-bottom: 12px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-size: 12px; margin-bottom: 4px;">Fecha</label>
              <input type="date" id="task-date" class="input-field" required>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-size: 12px; margin-bottom: 4px;">Medio</label>
              <select id="task-type" class="input-field" style="background-color: var(--bg-surface);">
                <option value="call">📞 Llamada</option>
                <option value="whatsapp">💬 WhatsApp</option>
                <option value="email">✉️ Correo</option>
                <option value="meeting">🤝 Reunión</option>
                <option value="note">📝 Tarea</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 12px;">
            <label class="form-label" style="font-size: 12px; margin-bottom: 4px;">Descripción / Detalles</label>
            <input type="text" id="task-desc" class="input-field" placeholder="Detalles de lo que se va a tratar...">
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 8px 16px; font-size: 13px;">Agendar en Calendario</button>
        </form>

        <h4 style="font-family: var(--font-heading); font-size: 15px; margin-bottom: 12px;">Tareas Programadas</h4>
        <div id="lead-reminders-list" style="display: flex; flex-direction: column; gap: 10px;">
          <!-- Reminders go here -->
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  // Setup Event Listeners
  backdrop.addEventListener('click', closeLeadDrawer);
  document.getElementById('btn-close-drawer').addEventListener('click', closeLeadDrawer);

  // Add custom field button listener
  document.getElementById('btn-add-custom-field').addEventListener('click', () => {
    const container = document.getElementById('custom-fields-container');
    if (!container) return;

    const rowDiv = document.createElement('div');
    rowDiv.className = 'custom-field-input-row';
    rowDiv.style.display = 'flex';
    rowDiv.style.gap = '8px';
    rowDiv.style.alignItems = 'center';
    rowDiv.style.marginBottom = '8px';

    rowDiv.innerHTML = `
      <input type="text" class="input-field custom-field-key" style="flex: 2; padding: 6px 10px; font-size: 12px; margin: 0;" placeholder="Nombre del Campo" value="">
      <span style="color: var(--text-muted);">:</span>
      <input type="text" class="input-field custom-field-val" style="flex: 3; padding: 6px 10px; font-size: 12px; margin: 0;" placeholder="Valor" value="">
      <button type="button" class="btn btn-secondary btn-delete-custom-field" style="padding: 6px 10px; font-size: 12px; margin: 0; color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2); width: auto; height: auto;">🗑️</button>
    `;

    rowDiv.querySelector('.btn-delete-custom-field').addEventListener('click', () => {
      rowDiv.remove();
    });

    container.appendChild(rowDiv);
    rowDiv.querySelector('.custom-field-key').focus();
  });

  // Tabs toggle
  const tabBtns = drawer.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      drawer.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      drawer.querySelector(`#${targetId}`).classList.add('active');
    });
  });

  // Edit form submit
  document.getElementById('form-edit-lead').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentLeadId) return;

    const name = document.getElementById('edit-name').value;
    const company = document.getElementById('edit-company').value;
    const email = document.getElementById('edit-email').value;
    const phone = document.getElementById('edit-phone').value;
    const website = document.getElementById('edit-website').value.trim();
    const socials = document.getElementById('edit-socials').value.trim();
    const status = document.getElementById('edit-status').value;
    const agent = document.getElementById('edit-agent').value;
    const pipelineState = document.getElementById('edit-pipeline-state').value;

    try {
      const oldLead = await getLeadById(currentLeadId);
      
      // Collect custom fields
      const customFields = {};
      const customFieldRows = document.querySelectorAll('.custom-field-input-row');
      customFieldRows.forEach(row => {
        const keyInput = row.querySelector('.custom-field-key');
        const valInput = row.querySelector('.custom-field-val');
        if (keyInput && valInput) {
          const key = keyInput.value.trim();
          const val = valInput.value.trim();
          if (key) {
            customFields[key] = val;
          }
        }
      });

      let finalAgent = agent;
      if (pipelineState !== '' && agent === 'unassigned') {
        const textToSearch = [
          name,
          company,
          website,
          socials,
          JSON.stringify(customFields),
          oldLead.sector || '',
          oldLead.entity_plural || ''
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

        if (!detectedAgent) {
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

        if (detectedAgent) {
          finalAgent = detectedAgent;
          document.getElementById('edit-agent').value = detectedAgent;
        }
      }

      const updated = {
        ...oldLead,
        name,
        company,
        email,
        phone,
        website,
        socials,
        status,
        agent: finalAgent,
        pipelineState,
        customFields
      };

      if (oldLead.agent !== finalAgent) {
        await addLog(currentLeadId, 'system', `Agente asignado automáticamente a "${finalAgent}" (antes "${oldLead.agent || 'unassigned'}") al guardar cambios con un estado de seguimiento activo.`);
      }

      currentLead = updated;
      await updateLead(updated);

      // Log status change if status changed
      if (oldLead.status !== status) {
        const oldName = STAGES[oldLead.status]?.label || oldLead.status;
        const newName = STAGES[status]?.label;
        await addLog(currentLeadId, 'system', `Estado cambiado de "${oldName}" a "${newName}"`);
      }

      // Log pipelineState change if changed
      if (oldLead.pipelineState !== pipelineState) {
        const oldName = PIPELINE_STATES[oldLead.pipelineState]?.label || 'ninguno';
        const newName = PIPELINE_STATES[pipelineState]?.label || 'ninguno';
        await addLog(currentLeadId, 'system', `Fase de seguimiento cambiada de "${oldName}" a "${newName}"`);
      }

      await addLog(currentLeadId, 'system', 'Información de contacto actualizada');
      
      // Update UI title in drawer
      document.getElementById('drawer-lead-name').textContent = name;
      document.getElementById('drawer-lead-company').textContent = company || 'SIN EMPRESA';
      
      // Refresh views
      if (onLeadChangedCallback) {
        onLeadChangedCallback();
      }

      // Show alert
      alert('Contacto guardado con éxito');
    } catch (err) {
      console.error(err);
      alert('Error al actualizar el lead');
    }
  });

  // Delete lead button
  document.getElementById('btn-delete-lead').addEventListener('click', async () => {
    if (!currentLeadId) return;
    
    if (confirm('¿Estás seguro de que quieres eliminar este lead? Se perderá todo su historial, notas y recordatorios del calendario.')) {
      try {
        await deleteLead(currentLeadId);
        closeLeadDrawer();
        if (onLeadChangedCallback) {
          onLeadChangedCallback();
        }
      } catch (err) {
        console.error(err);
        alert('Error al eliminar el lead');
      }
    }
  });

  // Quick Action Activity Log composers switching
  let activeLogType = 'note';
  const composerTitle = document.getElementById('activity-composer-title');
  const actionLinkDiv = document.getElementById('quick-action-link');
  const generatePitchBtn = document.getElementById('btn-generate-pitch');
  const pitchPanel = document.getElementById('pitch-generator-panel');
  const templateSelect = document.getElementById('pitch-template-select');
  const fieldsContainer = document.getElementById('pitch-dynamic-fields');
  const activityContent = document.getElementById('activity-content');

  // Sender configs elements
  const senderInput = document.getElementById('pitch-sender');
  const agencyInput = document.getElementById('pitch-agency');
  const urlInput = document.getElementById('pitch-url');
  const sectorSelect = document.getElementById('pitch-sector-select');
  const sectorInput = document.getElementById('pitch-sector');
  const featuresInput = document.getElementById('pitch-features');

  // Load sender details from storage or defaults
  const loadSenderConfigs = () => {
    senderInput.value = localStorage.getItem('pitch_sender') || SENDER_DEFAULTS.sender;
    agencyInput.value = localStorage.getItem('pitch_agency') || SENDER_DEFAULTS.agency;
    urlInput.value = localStorage.getItem('pitch_url') || SENDER_DEFAULTS.url;
    
    const savedSector = localStorage.getItem('pitch_sector') || SENDER_DEFAULTS.sector;
    sectorInput.value = savedSector;

    if (SECTOR_PRESETS[savedSector]) {
      sectorSelect.value = savedSector;
      sectorInput.style.display = 'none';
    } else {
      sectorSelect.value = 'custom';
      sectorInput.style.display = 'block';
    }

    featuresInput.value = localStorage.getItem('pitch_features') || SENDER_DEFAULTS.features;
  };

  const saveSenderConfigs = () => {
    localStorage.setItem('pitch_sender', senderInput.value);
    localStorage.setItem('pitch_agency', agencyInput.value);
    localStorage.setItem('pitch_url', urlInput.value);
    localStorage.setItem('pitch_sector', sectorInput.value);
    localStorage.setItem('pitch_features', featuresInput.value);
  };

  [senderInput, agencyInput, urlInput, sectorInput, featuresInput].forEach(input => {
    input.addEventListener('input', () => {
      saveSenderConfigs();
      regenerateMessage();
    });
  });

  sectorSelect.addEventListener('change', () => {
    const val = sectorSelect.value;
    if (val === 'custom') {
      sectorInput.style.display = 'block';
      sectorInput.value = '';
      sectorInput.focus();
    } else {
      sectorInput.style.display = 'none';
      sectorInput.value = val;
      
      // Prefill features based on preset
      if (SECTOR_PRESETS[val]) {
        featuresInput.value = SECTOR_PRESETS[val];
      }
    }
    saveSenderConfigs();
    regenerateMessage();
  });

  const updateContactLinks = () => {
    const phone = document.getElementById('edit-phone').value.replace(/[\s+-]/g, '');
    const email = document.getElementById('edit-email').value;
    const content = activityContent.value;
    const encodedText = encodeURIComponent(content);

    if (activeLogType === 'whatsapp') {
      if (phone) {
        actionLinkDiv.innerHTML = `<a href="https://wa.me/${phone}?text=${encodedText}" target="_blank" class="btn" style="background-color: #25d366; color: white; padding: 6px 14px; font-size: 12px; font-weight: 600; gap: 6px; display: inline-flex; align-items: center; box-shadow: 0 4px 12px rgba(37, 211, 102, 0.25); text-decoration: none; border-radius: var(--radius-sm); border: none;"><svg style="width:16px; height:16px;" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.835-4.86c1.62.962 3.21 1.462 4.908 1.463 5.4 0 9.795-4.39 9.798-9.789.001-2.585-1.002-5.015-2.827-6.84C16.945 2.15 14.516.957 11.93.957c-5.4 0-9.795 4.39-9.798 9.787a9.715 9.715 0 0 0 1.547 5.222L2.684 21.05l5.208-1.91zM17.486 15c-.3-.15-1.782-.88-2.062-.982-.28-.102-.485-.153-.69.153-.205.305-.795.98-.973 1.183-.18.203-.359.229-.66.079-1.35-.678-2.316-1.182-3.13-2.585-.213-.369.213-.342.61-.137.356.183.792.92.882 1.1.09.183.05.356-.025.508-.075.152-.69 1.66-.945 2.28-.248.608-.5.525-.69.515-.175-.01-.375-.01-.575-.01-.2 0-.525.075-.8.375-.275.3-.05 1.05.025 1.2.075.15.54 1.16 1.17 1.765 1.35.533.15 1.012.222 1.393.165.412-.061 1.275-.521 1.455-1 .18-.479.18-.89.127-.975-.053-.085-.2-.136-.5-.286z"/></svg>Enviar por WhatsApp</a>`;
      } else {
        actionLinkDiv.innerHTML = `<button class="btn" style="background-color: var(--text-muted); color: white; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: not-allowed; opacity: 0.6; display: inline-flex; align-items: center; gap: 6px; border: none;" disabled>⚠️ WhatsApp Sin Teléfono</button>`;
      }
    } else if (activeLogType === 'email') {
      if (email) {
        actionLinkDiv.innerHTML = `<a href="mailto:${email}?body=${encodedText}" class="btn" style="background-color: #3b82f6; color: white; padding: 6px 14px; font-size: 12px; font-weight: 600; gap: 6px; display: inline-flex; align-items: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25); text-decoration: none; border-radius: var(--radius-sm); border: none;"><svg style="width:16px; height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>Enviar por Correo</a>`;
      } else {
        actionLinkDiv.innerHTML = `<button class="btn" style="background-color: var(--text-muted); color: white; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: not-allowed; opacity: 0.6; display: inline-flex; align-items: center; gap: 6px; border: none;" disabled>⚠️ Correo Sin Dirección</button>`;
      }
    }
  };

  activityContent.addEventListener('input', updateContactLinks);

  // Pitch generation engine
  const regenerateMessage = () => {
    const templateIdx = parseInt(templateSelect.value);
    const template = TEMPLATES[templateIdx];
    if (!template) return;

    const senderVars = {
      sender: senderInput.value,
      agency: agencyInput.value,
      url: urlInput.value,
      sector: sectorInput.value,
      features: featuresInput.value
    };

    const dynamicVars = {};
    template.fields.forEach(field => {
      const input = document.getElementById(`field-${field.id}`);
      if (input) {
        dynamicVars[field.id] = input.value;
      } else {
        dynamicVars[field.id] = resolveFieldValue(field.id, template.id);
      }
    });

    const leadName = document.getElementById('edit-name').value;
    const leadCompany = document.getElementById('edit-company').value;
    const leadWebsite = document.getElementById('edit-website') ? document.getElementById('edit-website').value.trim() : '';
    const socialsValue = document.getElementById('edit-socials') ? document.getElementById('edit-socials').value.trim() : '';

    const timeVars = getDynamicGreetingVars(leadName);

    const finalVars = {
      ...senderVars,
      ...dynamicVars,
      ...timeVars,
      name: leadName,
      company: leadCompany,
      website: leadWebsite,
      socials: socialsValue
    };

    const message = template.generate(finalVars);
    activityContent.value = message;
    
    // Auto adjust text area height
    activityContent.style.height = 'auto';
    activityContent.style.height = (activityContent.scrollHeight) + 'px';

    updateContactLinks();
  };

  const renderTemplateFields = () => {
    const templateIdx = parseInt(templateSelect.value);
    const template = TEMPLATES[templateIdx];
    if (!template) return;

    fieldsContainer.innerHTML = '';
    
    template.fields.forEach(field => {
      const fieldId = `field-${field.id}`;
      const savedValKey = `pitch_field_${template.id}_${field.id}`;
      const initialValue = resolveFieldValue(field.id, template.id);

      const formGroup = document.createElement('div');
      formGroup.className = 'form-group';
      formGroup.style.marginBottom = '6px';
      formGroup.innerHTML = `
        <label class="form-label" style="font-size: 11px; margin-bottom: 2px;">${field.label}</label>
        <input type="text" id="${fieldId}" class="input-field" style="padding: 6px 10px; font-size: 11px;" placeholder="${field.placeholder}" value="${initialValue}">
      `;

      const input = formGroup.querySelector('input');
      input.addEventListener('input', () => {
        if (currentLead) {
          currentLead[field.id] = input.value;
          updateLead(currentLead).catch(console.error);
        }
        localStorage.setItem(savedValKey, input.value);
        regenerateMessage();
      });

      fieldsContainer.appendChild(formGroup);
    });

    regenerateMessage();
  };

  // Populate template options
  templateSelect.innerHTML = TEMPLATES.map((t, idx) => `<option value="${idx}">${t.name}</option>`).join('');
  templateSelect.addEventListener('change', renderTemplateFields);

  // AI Web Analysis Button Click Listener
  const analyzeBtn = document.getElementById('btn-ai-analyze-web');

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      const apiKey = localStorage.getItem('gespropec_gemini_api_key');
      if (!apiKey) {
        alert('Por favor, configura tu API Key de Gemini en la sección de Ajustes para poder usar la Inteligencia Artificial.');
        return;
      }

      const lead = await getLeadById(currentLeadId);
      if (!lead || !lead.website) {
        alert('Este prospecto no tiene un Sitio Web registrado. Añádelo en la pestaña de Información.');
        return;
      }

      // Start loader state
      analyzeBtn.disabled = true;
      analyzeBtn.style.opacity = '0.6';
      const originalText = analyzeBtn.innerHTML;
      analyzeBtn.innerHTML = `<span>⏳</span> Analizando...`;

      try {
        // Timeout helper to avoid infinite hanging
        const fetchWithTimeout = async (url, options = {}, timeoutMs = 8000) => {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            return response;
          } catch (error) {
            clearTimeout(id);
            throw error;
          }
        };

        // 1. Scrape webpage text using CORS-free Jina Reader with fallback proxy
        const targetUrl = lead.website.startsWith('http') ? lead.website : `https://${lead.website}`;
        const scrapeUrl = `https://r.jina.ai/${targetUrl}`;
        
        let scrapedText = '';
        try {
          // Attempt 1: Jina Reader (with 8s timeout)
          const scrapeResponse = await fetchWithTimeout(scrapeUrl, {}, 8000);
          if (!scrapeResponse.ok) {
            throw new Error(`Error en Jina Reader (Status ${scrapeResponse.status})`);
          }
          scrapedText = await scrapeResponse.text();
        } catch (e) {
          console.warn("Fallo Jina Reader, intentando AllOrigins...", e);
          try {
            // Attempt 2: AllOrigins proxy (with 8s timeout)
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
            const proxyResponse = await fetchWithTimeout(proxyUrl, {}, 8000);
            if (!proxyResponse.ok) {
              throw new Error(`Error en AllOrigins Proxy (Status ${proxyResponse.status})`);
            }
            const proxyData = await proxyResponse.json();
            const rawHtml = proxyData.contents;
            
            // Parse clean text out of the HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, 'text/html');
            doc.querySelectorAll('script, style, iframe, nav, footer, header').forEach(el => el.remove());
            scrapedText = doc.body.textContent || '';
          } catch (err) {
            console.error("Fallo total de extracción", err);
            throw new Error("No se pudo descargar la web (posible bloqueo por Cloudflare/CORS o timeout).");
          }
        }

        // Limit scraped text size to stay within context limits
        const truncatedText = scrapedText.substring(0, 15000);

        // 2. Call Gemini API
        const customFieldsStr = lead.customFields && Object.keys(lead.customFields).length > 0
          ? `\nDatos adicionales de la hoja de cálculo / CRM:\n${JSON.stringify(lead.customFields, null, 2)}\n(IMPORTANTE: Utiliza obligatoriamente los datos de ubicación reales de arriba como provincia, ciudad o región para la localización de la empresa. No utilices localizaciones de ejemplo como Triana si arriba se indica otra ciudad como Almería. También utiliza cualquier otra columna relevante para contextualizar el gancho).`
          : '';

        const prompt = `Analiza este contenido de la página web de la empresa "${lead.company || lead.name}" y extrae:
1. A qué se dedican exactamente y qué servicios ofrecen.
2. Dónde están ubicados (barrio, ciudad o región de España). Prioriza usar la ubicación indicada en los "Datos adicionales" proporcionados.
3. Escribe un gancho de prospección personalizado, profesional y sumamente natural en español, comentando algo específico y real que hayas visto en su web que sea elogiable (ej: su trayectoria, un proyecto concreto, sus valores o un servicio destacado) y conecta esto con por qué les vendría bien un CRM a medida para gestionar sus clientes, citas o presupuestos de forma eficiente.
4. Indica la entidad principal en plural con la que trabajan (ej: obras, reformas, clientes, coches, mascotas, pacientes, alumnos...).
5. El sector simplificado de la empresa (ej: constructora, peluquería canina, taller mecánico, etc.).
6. Una propuesta de valor de 2 a 3 líneas detallando qué módulos específicos de un CRM a medida servirían para este sector en particular (ej: para una constructora, control de presupuestos por obra, subcontratas, planos digitales y plazos de entrega; para un taller, ficha de vehículo con ITV y presupuestos).
Devuelve la respuesta en formato JSON estrictamente con la estructura:
{
  "company_name": "...",
  "location": "...",
  "entity_plural": "...",
  "audit_note": "...",
  "reviews_hook": "...",
  "affectionate_hook": "...",
  "sector": "...",
  "features": "..."
}`;

        const geminiUrl = `https://generativelaimultimodal.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `${prompt}${customFieldsStr}\n\nContenido web:\n${truncatedText}`
              }]
            }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Error de Gemini API: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
          throw new Error("La IA no devolvió ninguna respuesta válida.");
        }

        const aiResult = JSON.parse(responseText.trim());

        // 3. Populate inputs
        if (aiResult.company_name) {
          const editCompanyInput = document.getElementById('edit-company');
          if (editCompanyInput) {
            editCompanyInput.value = aiResult.company_name;
            lead.company = aiResult.company_name;
            document.getElementById('drawer-lead-company').textContent = aiResult.company_name;
          }
        }

        // Save AI extracted fields directly to the lead object for persistence
        lead.location = aiResult.location || '';
        lead.entity_plural = aiResult.entity_plural || '';
        lead.audit_note = aiResult.audit_note || '';
        lead.reviews_hook = aiResult.reviews_hook || '';
        lead.affectionate_hook = aiResult.affectionate_hook || '';
        lead.sector = aiResult.sector || '';
        lead.features = aiResult.features || '';
        await updateLead(lead);

        // Dynamically update Sector and CRM Features in sender config accordion
        if (aiResult.features) {
          const featuresInputEl = document.getElementById('pitch-features');
          if (featuresInputEl) {
            featuresInputEl.value = aiResult.features;
            localStorage.setItem('pitch_features', aiResult.features);
          }
        }
        if (aiResult.sector) {
          const sectorInputEl = document.getElementById('pitch-sector');
          const sectorSelectEl = document.getElementById('pitch-sector-select');
          if (sectorInputEl) {
            sectorInputEl.value = aiResult.sector;
            localStorage.setItem('pitch_sector', aiResult.sector);
            if (sectorSelectEl) {
              if (SECTOR_PRESETS[aiResult.sector]) {
                sectorSelectEl.value = aiResult.sector;
                sectorInputEl.style.display = 'none';
              } else {
                sectorSelectEl.value = 'custom';
                sectorInputEl.style.display = 'block';
              }
            }
          }
        }

        // Fill template dynamic fields if they exist on the page
        const fieldsMapping = {
          'location': aiResult.location,
          'entity_plural': aiResult.entity_plural,
          'audit_note': aiResult.audit_note,
          'reviews_hook': aiResult.reviews_hook,
          'affectionate_hook': aiResult.affectionate_hook
        };

        const template = TEMPLATES[parseInt(templateSelect.value)];
        Object.entries(fieldsMapping).forEach(([key, val]) => {
          if (!val) return;
          const inputEl = document.getElementById(`field-${key}`);
          if (inputEl) {
            inputEl.value = val;
          }
          // Save in localStorage for ALL templates so it's active everywhere
          TEMPLATES.forEach(t => {
            localStorage.setItem(`pitch_field_${t.id}_${key}`, val);
          });
        });

        // 4. Regenerate message automatically!
        regenerateMessage();

        // 5. Add log about AI analysis
        await addLog(currentLeadId, 'system', `Análisis web IA completado con éxito. Se detectó ubicación: "${aiResult.location || 'desconocida'}" y entidad: "${aiResult.entity_plural || 'general'}".`);

        // Refresh views
        if (onLeadChangedCallback) {
          onLeadChangedCallback();
        }

        alert('¡Análisis completado! Se han rellenado los campos con los datos reales de su web.');

      } catch (err) {
        console.error(err);
        alert(`Error al analizar la web: ${err.message || err}`);
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.style.opacity = '1';
        analyzeBtn.innerHTML = originalText;
      }
    });
  }

  generatePitchBtn.addEventListener('click', () => {
    const isVisible = pitchPanel.style.display === 'flex';
    if (isVisible) {
      pitchPanel.style.display = 'none';
      generatePitchBtn.style.backgroundColor = 'rgba(255,255,255,0.02)';
      generatePitchBtn.style.color = 'var(--text-secondary)';
    } else {
      pitchPanel.style.display = 'flex';
      generatePitchBtn.style.backgroundColor = 'var(--accent-purple-glow)';
      generatePitchBtn.style.color = '#c084fc';
      loadSenderConfigs();
      renderTemplateFields();
    }
  });

  const logTypeButtons = drawer.querySelectorAll('.btn-log-action');
  logTypeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      logTypeButtons.forEach(b => b.style.backgroundColor = 'rgba(255,255,255,0.02)');
      btn.style.backgroundColor = 'rgba(255,255,255,0.08)';
      
      activeLogType = btn.dataset.type;
      
      // Close pitch generator when switching to non-pitch tabs
      pitchPanel.style.display = 'none';
      generatePitchBtn.style.backgroundColor = 'rgba(255,255,255,0.02)';
      generatePitchBtn.style.color = 'var(--text-secondary)';

      // Reset text area height
      activityContent.style.height = 'auto';

      // Check if website exists to show/hide AI button
      const editWebsiteVal = document.getElementById('edit-website') ? document.getElementById('edit-website').value.trim() : '';
      const hasWebsite = editWebsiteVal !== '';

      // Update heading text
      if (activeLogType === 'note') {
        composerTitle.textContent = 'Añadir Nota Rápida';
        actionLinkDiv.innerHTML = '';
        generatePitchBtn.style.display = 'none';
        analyzeBtn.style.display = 'none';
      } else if (activeLogType === 'call') {
        composerTitle.textContent = 'Registrar Resultado de Llamada';
        actionLinkDiv.innerHTML = '';
        generatePitchBtn.style.display = 'none';
        analyzeBtn.style.display = 'none';
      } else if (activeLogType === 'whatsapp') {
        composerTitle.textContent = 'Registrar Mensaje de WhatsApp';
        generatePitchBtn.style.display = 'inline-flex';
        analyzeBtn.style.display = hasWebsite ? 'inline-flex' : 'none';
        updateContactLinks();
      } else if (activeLogType === 'email') {
        composerTitle.textContent = 'Registrar Email Enviado/Recibido';
        generatePitchBtn.style.display = 'inline-flex';
        analyzeBtn.style.display = hasWebsite ? 'inline-flex' : 'none';
        updateContactLinks();
      }
    });
  });

  // Save activity/log
  document.getElementById('btn-save-activity').addEventListener('click', async () => {
    const textEl = document.getElementById('activity-content');
    const content = textEl.value.trim();
    if (!content) {
      alert('Escribe algún contenido antes de guardar.');
      return;
    }

    try {
      let typeLabel = activeLogType.toUpperCase();
      if (activeLogType === 'note') typeLabel = 'NOTA';
      if (activeLogType === 'call') typeLabel = 'LLAMADA';
      if (activeLogType === 'whatsapp') typeLabel = 'WHATSAPP';
      if (activeLogType === 'email') typeLabel = 'EMAIL';

      await addLog(currentLeadId, activeLogType, content);
      
      // Clear textarea
      textEl.value = '';
      
      // Reload timeline tab
      await loadTimeline(currentLeadId);
      
      if (onLeadChangedCallback) {
        onLeadChangedCallback();
      }
    } catch (err) {
      console.error(err);
      alert('Error al registrar actividad');
    }
  });

  // Form add reminder
  document.getElementById('form-add-reminder').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentLeadId) return;

    const title = document.getElementById('task-title').value.trim();
    const date = document.getElementById('task-date').value;
    const type = document.getElementById('task-type').value;
    const description = document.getElementById('task-desc').value.trim();

    try {
      await addReminder({
        leadId: currentLeadId,
        title,
        date,
        type,
        description,
        status: 'pending'
      });

      // Reset form
      document.getElementById('task-title').value = '';
      document.getElementById('task-desc').value = '';
      
      // Write system log that a task was scheduled
      const typeIcons = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', note: '📝' };
      await addLog(currentLeadId, 'system', `Programada acción: "${title}" (${typeIcons[type]} el ${date})`);

      // Reload reminders tab and updates
      await loadReminders(currentLeadId);
      await loadTimeline(currentLeadId);

      if (onLeadChangedCallback) {
        onLeadChangedCallback();
      }
    } catch (err) {
      console.error(err);
      alert('Error al agendar tarea');
    }
  });
}

// Open the Drawer for a specific Lead
export async function openLeadDrawer(leadId, activeTabId = 'tab-history') {
  currentLeadId = leadId;
  setupModalDOM(); // Ensure DOM exists

  try {
    const lead = await getLeadById(leadId);
    if (!lead) return;
    currentLead = lead;

    // Fill contact details
    document.getElementById('drawer-lead-name').textContent = lead.name;
    document.getElementById('drawer-lead-company').textContent = lead.company || 'SIN EMPRESA';
    document.getElementById('edit-name').value = lead.name;
    document.getElementById('edit-company').value = lead.company || '';
    document.getElementById('edit-email').value = lead.email || '';
    document.getElementById('edit-phone').value = lead.phone || '';
    document.getElementById('edit-website').value = lead.website || '';
    document.getElementById('edit-socials').value = lead.socials || '';
    document.getElementById('edit-status').value = lead.status || 'new';
    document.getElementById('edit-agent').value = lead.agent || 'unassigned';
    document.getElementById('edit-pipeline-state').value = lead.pipelineState || '';

    // Render custom fields
    const customFieldsSection = document.getElementById('custom-fields-section');
    const customFieldsContainer = document.getElementById('custom-fields-container');
    if (customFieldsSection && customFieldsContainer) {
      customFieldsContainer.innerHTML = '';
      customFieldsSection.style.display = 'block'; // Always display the section so user can add custom fields manually!
      
      const customFields = lead.customFields || {};
      Object.entries(customFields).forEach(([key, value]) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'custom-field-input-row';
        rowDiv.style.display = 'flex';
        rowDiv.style.gap = '8px';
        rowDiv.style.alignItems = 'center';
        rowDiv.style.marginBottom = '8px';
        
        rowDiv.innerHTML = `
          <input type="text" class="input-field custom-field-key" style="flex: 2; padding: 6px 10px; font-size: 12px; margin: 0;" placeholder="Nombre del Campo" value="${key}">
          <span style="color: var(--text-muted);">:</span>
          <input type="text" class="input-field custom-field-val" style="flex: 3; padding: 6px 10px; font-size: 12px; margin: 0;" placeholder="Valor" value="${value}">
          <button type="button" class="btn btn-secondary btn-delete-custom-field" style="padding: 6px 10px; font-size: 12px; margin: 0; color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2); width: auto; height: auto;">🗑️</button>
        `;
        
        rowDiv.querySelector('.btn-delete-custom-field').addEventListener('click', () => {
          rowDiv.remove();
        });
        
        customFieldsContainer.appendChild(rowDiv);
      });
    }

    // Set default active tab
    const drawer = document.getElementById('lead-drawer');
    drawer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    drawer.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    const targetTab = activeTabId === 'tab-info' ? 'tab-info' : 'tab-history';
    drawer.querySelector(`.tab-btn[data-tab="${targetTab}"]`).classList.add('active');
    drawer.querySelector(`#${targetTab}`).classList.add('active');

    // Trigger visual selection on the log button (default Note)
    const logTypeButtons = drawer.querySelectorAll('.btn-log-action');
    logTypeButtons.forEach(b => b.style.backgroundColor = 'rgba(255,255,255,0.02)');
    drawer.querySelector('.btn-log-action.note').style.backgroundColor = 'rgba(255,255,255,0.08)';
    document.getElementById('activity-composer-title').textContent = 'Añadir Nota Rápida';
    document.getElementById('quick-action-link').innerHTML = '';
    document.getElementById('activity-content').value = '';
    document.getElementById('btn-generate-pitch').style.display = 'none';
    document.getElementById('btn-ai-analyze-web').style.display = 'none';
    document.getElementById('pitch-generator-panel').style.display = 'none';
    document.getElementById('btn-generate-pitch').style.backgroundColor = 'rgba(255,255,255,0.02)';
    document.getElementById('btn-generate-pitch').style.color = 'var(--text-secondary)';

    // Load data for other tabs
    await loadTimeline(leadId);
    await loadReminders(leadId);

    // Slide in
    document.getElementById('lead-drawer-backdrop').classList.add('active');
    document.getElementById('lead-drawer').classList.add('active');

  } catch (error) {
    console.error('Error fetching lead data for drawer:', error);
    alert('No se pudo cargar la información del prospecto.');
  }
}

export function closeLeadDrawer() {
  const backdrop = document.getElementById('lead-drawer-backdrop');
  const drawer = document.getElementById('lead-drawer');
  if (backdrop && drawer) {
    backdrop.classList.remove('active');
    drawer.classList.remove('active');
  }
  currentLeadId = null;
}

// Load activity logs list
async function loadTimeline(leadId) {
  const timelineEl = document.getElementById('lead-timeline');
  timelineEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">Cargando historial...</div>';

  try {
    const logs = await getLogsForLead(leadId);
    if (logs.length === 0) {
      timelineEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">No hay interacciones registradas.</div>';
      return;
    }

    const typeIcons = {
      note: '📝',
      call: '📞',
      whatsapp: '💬',
      email: '✉️',
      meeting: '🤝',
      system: '⚙️'
    };

    const typeClasses = {
      note: 'note',
      call: 'call',
      whatsapp: 'whatsapp',
      email: 'email',
      meeting: 'meeting',
      system: 'system'
    };

    timelineEl.innerHTML = logs.map(log => {
      const icon = typeIcons[log.type] || '📝';
      const cssClass = typeClasses[log.type] || 'note';
      const timeStr = new Date(log.timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      let title = '';
      if (log.type === 'note') title = 'Nota de Seguimiento';
      else if (log.type === 'call') title = 'Llamada';
      else if (log.type === 'whatsapp') title = 'Mensaje de WhatsApp';
      else if (log.type === 'email') title = 'Correo Electrónico';
      else if (log.type === 'meeting') title = 'Reunión / Cita';
      else if (log.type === 'system') title = 'Sistema';

      return `
        <div class="timeline-item ${cssClass}">
          <span class="timeline-dot">${icon}</span>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-title">${title}</span>
              <span class="timeline-time">${timeStr}</span>
            </div>
            <div class="timeline-body">${log.content}</div>
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error(error);
    timelineEl.innerHTML = '<div style="font-size:11px;color:var(--accent-red)">Error al cargar historial.</div>';
  }
}

// Load agenda reminders list
async function loadReminders(leadId) {
  const listEl = document.getElementById('lead-reminders-list');
  listEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">Cargando recordatorios...</div>';

  try {
    const reminders = await getRemindersForLead(leadId);
    
    if (reminders.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">No hay tareas pendientes para este lead.</div>';
      return;
    }

    // Sort: pending first, then by date ascending
    reminders.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'pending' ? -1 : 1;
      }
      return new Date(a.date) - new Date(b.date);
    });

    const typeIcons = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', note: '📝' };

    listEl.innerHTML = '';
    reminders.forEach(rem => {
      const pill = document.createElement('div');
      pill.className = 'glass-card';
      pill.style.padding = '12px 16px';
      pill.style.display = 'flex';
      pill.style.alignItems = 'center';
      pill.style.justifyContent = 'space-between';
      pill.style.gap = '12px';
      
      if (rem.status === 'completed') {
        pill.style.opacity = '0.5';
      }

      const icon = typeIcons[rem.type] || '📝';
      const formattedDate = new Date(rem.date + 'T00:00:00').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      });

      pill.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: flex-start; flex-grow: 1;">
          <input type="checkbox" class="task-checkbox" data-id="${rem.id}" ${rem.status === 'completed' ? 'checked' : ''} style="margin-top: 4px; cursor: pointer;">
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 13px; font-weight: 600; text-decoration: ${rem.status === 'completed' ? 'line-through' : 'none'}">${icon} ${rem.title}</span>
            ${rem.description ? `<span style="font-size: 11px; color: var(--text-secondary);">${rem.description}</span>` : ''}
            <span style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Fecha límite: ${formattedDate}</span>
          </div>
        </div>
        <button class="btn-delete-task" data-id="${rem.id}" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:14px; padding:4px;">
          ✕
        </button>
      `;

      // Event listener for toggle completed
      const checkbox = pill.querySelector('.task-checkbox');
      checkbox.addEventListener('change', async () => {
        rem.status = checkbox.checked ? 'completed' : 'pending';
        await updateReminder(rem);
        
        // Log action completion
        if (rem.status === 'completed') {
          await addLog(leadId, 'system', `Completada acción: "${rem.title}"`);
        } else {
          await addLog(leadId, 'system', `Marcada como pendiente: "${rem.title}"`);
        }
        
        await loadReminders(leadId);
        await loadTimeline(leadId);
        
        if (onLeadChangedCallback) {
          onLeadChangedCallback();
        }
      });

      // Event listener for delete
      const deleteBtn = pill.querySelector('.btn-delete-task');
      deleteBtn.addEventListener('click', async () => {
        if (confirm('¿Eliminar esta tarea programada?')) {
          await deleteReminder(rem.id);
          await addLog(leadId, 'system', `Eliminada tarea: "${rem.title}"`);
          
          await loadReminders(leadId);
          await loadTimeline(leadId);
          
          if (onLeadChangedCallback) {
            onLeadChangedCallback();
          }
        }
      });

      listEl.appendChild(pill);
    });

  } catch (error) {
    console.error(error);
    listEl.innerHTML = '<div style="font-size:11px;color:var(--accent-red)">Error al cargar la agenda.</div>';
  }
}
