import './style.css';
import { 
  initDB, 
  getAllLeads, 
  getLeadsFilteredByAgent,
  addLead, 
  updateLead,
  deleteLead,
  addLog, 
  addReminder,
  exportDatabase, 
  importDatabase 
} from './db.js';
import { initBoard, renderBoard, STAGES } from './components/board.js';
import { initLeadModal, openLeadDrawer } from './components/leadModal.js';
import { initNotifications, refreshNotifications } from './components/notifications.js';
import { initCalendar, renderCalendar } from './calendar.js';
import { renderDashboard } from './dashboard.js';
import { initList, renderList } from './components/list.js';
import { 
  parseCSV, 
  fetchCSV, 
  processImportedRows, 
  autoDetectMapping 
} from './importer.js';
import { 
  mockLeads, 
  mockLogs, 
  mockReminders, 
  mockGoogleSheetsCSV 
} from './mockData.js';

// Application state
let currentView = 'dashboard';
let parsedCsvData = null; // Stores parsed 2D array from sheet
let currentMapping = null;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Initialize DB
    await initDB();
    
    // 2. Clear predefined demo/mock leads from IndexedDB
    const existing = await getAllLeads();
    const mockIds = ['lead-1', 'lead-2', 'lead-3', 'lead-4', 'lead-5', 'lead-6', 'lead-7'];
    for (const lead of existing) {
      if (mockIds.includes(lead.id)) {
        await deleteLead(lead.id);
      }
    }

    await autoAssignAgentsToExistingLeads();

    // 3. Initialize components
    initLeadModal(handleDatabaseUpdate);
    initBoard(handleLeadClick, handleDatabaseUpdate);
    initCalendar(handleLeadClick);
    initNotifications(handleLeadClick);
    initList(handleLeadClick, handleDatabaseUpdate);
    
    // 4. Setup routing
    setupNavigation();
    
    // 5. Setup UI events
    setupImporterUI();
    setupSettingsUI();
    setupQuickAddUI();
    setupClientsUI();
    setupAgentFilterUI();
    
    // 6. Global custom listeners
    document.addEventListener('database-updated', handleDatabaseUpdate);
    document.addEventListener('open-lead-detail', (e) => {
      if (e.detail) {
        handleLeadClick(e.detail);
      }
    });

    // 7. Initial load
    switchView('dashboard');
    await refreshNotifications();

  } catch (error) {
    console.error('App boot failure:', error);
  }
});

// Refresh whichever view is currently active
async function refreshCurrentView() {
  switch (currentView) {
    case 'dashboard':
      await renderDashboard('view-dashboard');
      break;
    case 'kanban':
      await renderBoard('kanban-board-container');
      break;
    case 'clients':
      await renderClientsTable();
      break;
    case 'calendar':
      await renderCalendar('calendar-container');
      break;
    case 'lista':
      await renderList('lista-container');
      break;
    case 'import':
      // Importer views persist on form states, no immediate re-render needed
      break;
    case 'settings':
      break;
  }
}

// Callback when data changes inside components
async function handleDatabaseUpdate() {
  await refreshCurrentView();
  await refreshNotifications();
}

function handleLeadClick(leadId) {
  openLeadDrawer(leadId);
}

/* ==========================================================================
   NAVIGATION & VIEWS SWITCHER
   ========================================================================== */

function setupNavigation() {
  const menuItems = document.querySelectorAll('.menu-item');
  
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetView = item.dataset.view;
      if (!targetView) return;
      
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      switchView(targetView);
    });
  });
}

async function switchView(viewName) {
  currentView = viewName;
  
  // Hide all sections
  document.querySelectorAll('.app-view').forEach(view => {
    view.style.display = 'none';
  });
  
  // Show target section
  const targetSection = document.getElementById(`view-${viewName}`);
  if (targetSection) {
    targetSection.style.display = 'block';
  }
  
  // Set header title
  const titles = {
    dashboard: 'Panel Principal',
    kanban: 'Tablero Kanban',
    clients: 'Cartera de Clientes',
    calendar: 'Calendario de Agenda',
    lista: 'Lista de Prospectos',
    import: 'Importar desde Google Sheets',
    settings: 'Configuración del CRM'
  };
  document.getElementById('current-view-title').textContent = titles[viewName] || 'GesPropec';
  
  // Render contents
  await refreshCurrentView();
}

/* ==========================================================================
   GOOGLE SHEETS IMPORTER UI LOGIC
   ========================================================================== */

// Fetch both Jordan tab URL and Sandra tab URL and merge into one dataset
async function fetchBothTabs(jordanUrl, sandraUrl) {
  const [csvJordan, csvSandra] = await Promise.all([
    fetchCSV(jordanUrl),
    fetchCSV(sandraUrl)
  ]);

  const rowsJordan = parseCSV(csvJordan);
  const rowsSandra = parseCSV(csvSandra);

  if (rowsJordan.length < 2) throw new Error('La pestaña de Jordan Caninas está vacía o no se pudo leer.');
  if (rowsSandra.length < 2) throw new Error('La pestaña de Sandra Corredurías está vacía o no se pudo leer.');

  const headers = rowsJordan[0];
  const merged = [headers, ...rowsJordan.slice(1), ...rowsSandra.slice(1)];
  return merged;
}

function setupImporterUI() {
  const urlTabBtn = document.getElementById('btn-import-url-tab');
  const fileTabBtn = document.getElementById('btn-import-file-tab');
  const urlPane = document.getElementById('import-url-pane');
  const filePane = document.getElementById('import-file-pane');

  const fetchBtn = document.getElementById('btn-fetch-sheets');
  const fileInput = document.getElementById('import-csv-file');
  const sheetUrlInput = document.getElementById('import-sheets-url');
  const sandraUrlInput = document.getElementById('import-sheets-url-sandra');
  const sandraWrap = document.getElementById('import-both-sandra-wrap');

  const mapperCard = document.getElementById('mapper-card');
  const previewCard = document.getElementById('preview-card');

  const tabSelectUrl = document.getElementById('import-sheet-tab-select-url');
  const tabSelectMapper = document.getElementById('import-sheet-tab-select-mapper');
  const defaultAgentSelect = document.getElementById('import-default-agent');

  // Show/hide Sandra URL field and sync agent select on tab change
  tabSelectUrl.addEventListener('change', () => {
    const isBoth = tabSelectUrl.value === 'both';
    sandraWrap.style.display = isBoth ? 'block' : 'none';
    defaultAgentSelect.value = isBoth ? 'auto' : tabSelectUrl.value;
  });

  // Re-fetch function on mapper tab change
  const handleTabChange = async (newTab) => {
    tabSelectUrl.value = newTab;
    tabSelectMapper.value = newTab;
    defaultAgentSelect.value = newTab === 'both' ? 'auto' : newTab;

    const url = sheetUrlInput.value.trim();
    if (!url) return;

    tabSelectMapper.disabled = true;
    try {
      let rows;
      if (newTab === 'both') {
        tabSelectMapper.disabled = true;
        rows = await fetchBothTabs(url);
      } else {
        const finalUrl = getUrlWithTabGid(url, newTab);
        rows = parseCSV(await fetchCSV(finalUrl));
      }

      if (rows.length < 2) throw new Error('Las hojas seleccionadas están vacías.');
      parsedCsvData = rows;
      setupMapperOptions(parsedCsvData[0]);
      previewCard.style.display = 'none';
    } catch (err) {
      alert('Error al cambiar de pestaña: ' + err.message);
    } finally {
      tabSelectMapper.disabled = false;
    }
  };

  tabSelectMapper.addEventListener('change', () => {
    handleTabChange(tabSelectMapper.value);
  });

  // Sub-tabs switching
  urlTabBtn.addEventListener('click', () => {
    urlTabBtn.classList.add('active');
    fileTabBtn.classList.remove('active');
    urlPane.style.display = 'block';
    filePane.style.display = 'none';
  });

  fileTabBtn.addEventListener('click', () => {
    fileTabBtn.classList.add('active');
    urlTabBtn.classList.remove('active');
    filePane.style.display = 'block';
    urlPane.style.display = 'none';
  });

  // URL Import Fetch Trigger
  fetchBtn.addEventListener('click', async () => {
    const url = sheetUrlInput.value.trim();
    if (!url) {
      alert('Ingresa una URL válida de Google Sheets.');
      return;
    }

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Descargando datos...';

    try {
      const selectedTab = tabSelectUrl.value;
      let rows;

      if (selectedTab === 'both') {
        const sandraUrl = sandraUrlInput ? sandraUrlInput.value.trim() : '';
        if (!sandraUrl) {
          alert('Para importar ambas columnas necesitas pegar también la URL de la pestaña de Sandra Corredurías.');
          return;
        }
        fetchBtn.textContent = 'Descargando ambas pestañas...';
        // url = Jordan tab URL, sandraUrl = Sandra tab URL
        rows = await fetchBothTabs(url, sandraUrl);
      } else {
        // Pass the URL directly — fetchCSV extracts gid from the URL automatically
        rows = parseCSV(await fetchCSV(url));
      }

      if (rows.length < 2) throw new Error('La hoja está vacía o no tiene el formato correcto.');
      parsedCsvData = rows;

      setupMapperOptions(parsedCsvData[0]);

      // Sync mapper selections and agent default
      tabSelectMapper.value = selectedTab;
      defaultAgentSelect.value = selectedTab === 'both' ? 'auto' : selectedTab;

      // Reveal mapper card
      mapperCard.style.display = 'block';
      previewCard.style.display = 'none';
      mapperCard.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
      alert(error.message);
      mapperCard.style.display = 'none';
      previewCard.style.display = 'none';
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Descargar y Sincronizar';
    }
  });

  // File Import Picker Trigger
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        parsedCsvData = parseCSV(text);
        
        if (parsedCsvData.length < 2) {
          throw new Error('El archivo CSV está vacío o no contiene suficientes filas.');
        }

        setupMapperOptions(parsedCsvData[0]);
        
        mapperCard.style.display = 'block';
        previewCard.style.display = 'none';
        
        mapperCard.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        alert('Error al leer el archivo CSV: ' + err.message);
        mapperCard.style.display = 'none';
        previewCard.style.display = 'none';
      }
    };
    reader.readAsText(file);
  });

  // Map apply trigger
  document.getElementById('btn-apply-mapping').addEventListener('click', async () => {
    if (!parsedCsvData) return;

    const selects = document.querySelectorAll('.column-map-select');
    currentMapping = {
      name: -1,
      company: -1,
      email: -1,
      phone: -1,
      website: -1,
      socials: -1,
      notes: -1
    };

    const headerMapping = {};
    selects.forEach(select => {
      const colIdx = parseInt(select.dataset.colIndex);
      const val = select.value;
      const headerName = parsedCsvData[0][colIdx];
      
      headerMapping[headerName] = val;
      
      if (val !== 'ignore') {
        currentMapping[val] = colIdx;
      }
    });

    if (currentMapping.name === -1) {
      alert('Debes asociar alguna columna al campo obligatorio "Nombre Completo" para poder identificar los contactos.');
      return;
    }

    // Save current mapping configurations in LocalStorage
    localStorage.setItem('gespropec_column_mapping', JSON.stringify(currentMapping));
    localStorage.setItem('gespropec_header_column_mapping', JSON.stringify(headerMapping));

    await renderImportPreview();
  });

  // ── Core import function (used by all three buttons) ───────────────────────
  // overrideMode:
  //   'auto'   → detect Jordan/Sandra from row content (caninas vs corredurías)
  //   'lista'  → everyone gets agent='unassigned' (shared Lista view)
  //   null     → use the selector value (original behaviour)
  async function executeImport(overrideMode) {
    const executeBtn    = document.getElementById('btn-import-execute');
    const autoBtn       = document.getElementById('btn-import-auto-assign');
    const listaBtn      = document.getElementById('btn-import-to-lista');
    const allBtns       = [executeBtn, autoBtn, listaBtn];

    allBtns.forEach(b => { if (b) b.disabled = true; });
    if (overrideMode === 'auto')  { autoBtn.textContent  = 'Asignando…'; }
    else if (overrideMode === 'lista') { listaBtn.innerHTML = '⏳ Añadiendo…'; }
    else { executeBtn.textContent = 'Importando…'; }

    try {
      const processed  = await processImportedRows(parsedCsvData, currentMapping);
      const toImport   = processed.leads.filter(l => !l.exists);

      if (toImport.length === 0) {
        alert('No hay leads nuevos para importar. Todos los contactos ya están en seguimiento.');
        return;
      }

      // Determine which tab was selected (so rows from Sandra URL → sandra, from Jordan → jordan)
      const selectedTab    = document.getElementById('import-sheet-tab-select-url')?.value;
      const selectorAgent  = document.getElementById('import-default-agent')?.value;

      let count = 0;
      for (const lead of toImport) {
        let assignedAgent = 'unassigned';

        if (overrideMode === 'lista') {
          // Shared list: no agent assigned; visible to everyone in Lista view
          assignedAgent = 'unassigned';

        } else if (overrideMode === 'auto') {
          // Auto-detect from row content keywords
          const rowText = lead.originalRow.join(' ').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const isJordan = rowText.includes('canin') || rowText.includes('perro') ||
                           rowText.includes('dog')   || rowText.includes('mascota') ||
                           rowText.includes('veterinari') || rowText.includes('grooming') ||
                           rowText.includes('felina') || rowText.includes('gato');
          const isSandra = rowText.includes('corredur') || rowText.includes('segur') ||
                           rowText.includes('broker')   || rowText.includes('mutua') ||
                           rowText.includes('ksm')      || rowText.includes('asegur') ||
                           rowText.includes('peritaje') || rowText.includes('asistencia');

          // Also use the selected tab as a strong signal when detecting ambiguous rows
          if (selectedTab === 'jordan') {
            assignedAgent = 'jordan';
          } else if (selectedTab === 'sandra') {
            assignedAgent = 'sandra';
          } else if (isJordan && !isSandra) {
            assignedAgent = 'jordan';
          } else if (isSandra && !isJordan) {
            assignedAgent = 'sandra';
          } else if (lead.agent && lead.agent !== 'unassigned') {
            assignedAgent = lead.agent;
          }
          // else stays 'unassigned'

        } else {
          // Original mode: respect lead.agent if set, else use selector value
          if (lead.agent && lead.agent !== 'unassigned') {
            assignedAgent = lead.agent;
          } else if (selectorAgent === 'jordan') {
            assignedAgent = 'jordan';
          } else if (selectorAgent === 'sandra') {
            assignedAgent = 'sandra';
          } else if (selectorAgent === 'auto') {
            const rowText = lead.originalRow.join(' ').toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (rowText.includes('canin') || rowText.includes('perro') || rowText.includes('dog') ||
                rowText.includes('mascota') || rowText.includes('veterinari') || rowText.includes('grooming')) {
              assignedAgent = 'jordan';
            } else if (rowText.includes('corredur') || rowText.includes('segur') || rowText.includes('broker') ||
                       rowText.includes('mutua') || rowText.includes('ksm') || rowText.includes('asegur')) {
              assignedAgent = 'sandra';
            }
          }
        }

        const finalLead = {
          id: 'lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          name:         lead.name,
          email:        lead.email,
          phone:        lead.phone,
          company:      lead.company,
          website:      lead.website  || '',
          socials:      lead.socials  || '',
          agent:        assignedAgent,
          customFields: lead.customFields || {},
          status:       'new'
        };

        await addLead(finalLead);
        await addLog(finalLead.id, 'system', 'Lead creado e importado desde Google Sheets.');
        if (lead.initialNotes) {
          await addLog(finalLead.id, 'note', `Nota importada: "${lead.initialNotes}"`);
        }
        count++;
      }

      const modeLabel = overrideMode === 'auto'  ? 'asignados automáticamente a Jordan/Sandra'
                      : overrideMode === 'lista' ? 'añadidos a la Lista compartida'
                      : 'pasados a Seguimiento';
      alert(`¡Completado! ${count} prospectos ${modeLabel}.`);

      // Reset UI
      mapperCard.style.display  = 'none';
      previewCard.style.display = 'none';
      sheetUrlInput.value = '';
      if (fileInput) fileInput.value = '';
      parsedCsvData = null;

      // Navigate to the right view
      switchView(overrideMode === 'lista' ? 'lista' : 'kanban');
      await refreshNotifications();

    } catch (err) {
      console.error(err);
      alert('Error durante la importación: ' + err.message);
    } finally {
      allBtns.forEach(b => { if (b) b.disabled = false; });
      if (executeBtn) executeBtn.textContent = 'Pasar Nuevos a Seguimiento';
      if (autoBtn)    autoBtn.innerHTML = `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg> Asignar a Jordan / Sandra`;
      if (listaBtn)   listaBtn.innerHTML = `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 6h18M3 14h18M3 18h18"/></svg> Añadir a Lista`;
    }
  }

  // Button handlers
  document.getElementById('btn-import-execute')
    .addEventListener('click', () => executeImport(null));

  document.getElementById('btn-import-auto-assign')
    .addEventListener('click', () => executeImport('auto'));

  document.getElementById('btn-import-to-lista')
    .addEventListener('click', () => executeImport('lista'));
}


function setupMapperOptions(headers) {
  const container = document.querySelector('.mapper-container');
  if (!container) return;

  container.innerHTML = '';

  const detectFieldForHeader = (header) => {
    const norm = header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (norm.includes('nombre') || norm.includes('name') || norm.includes('contacto') || norm.includes('cliente')) return 'name';
    if (norm.includes('empresa') || norm.includes('company') || norm.includes('negocio') || norm.includes('organizacion')) return 'company';
    if (norm.includes('email') || norm.includes('correo') || norm.includes('mail')) return 'email';
    if (norm.includes('telefono') || norm.includes('phone') || norm.includes('celular') || norm.includes('movil') || norm.includes('whatsapp') || norm.includes('tel')) return 'phone';
    if (norm.includes('web') || norm.includes('site') || norm.includes('sitio') || norm.includes('url') || norm.includes('pagina')) return 'website';
    if (norm.includes('redes') || norm.includes('social') || norm.includes('insta') || norm.includes('fb') || norm.includes('link') || norm.includes('twitter')) return 'socials';
    if (norm.includes('nota') || norm.includes('comentario') || norm.includes('observacion') || norm.includes('detalles') || norm.includes('info') || norm.includes('descripcion') || norm.includes('historial')) return 'notes';
    return 'ignore';
  };

  const savedHeaderMappingStr = localStorage.getItem('gespropec_header_column_mapping');
  const savedHeaderMapping = savedHeaderMappingStr ? JSON.parse(savedHeaderMappingStr) : null;

  headers.forEach((header, index) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'mapper-row';
    rowDiv.style.display = 'flex';
    rowDiv.style.alignItems = 'center';
    rowDiv.style.justifyContent = 'space-between';
    rowDiv.style.gap = '16px';
    rowDiv.style.marginBottom = '12px';

    rowDiv.innerHTML = `
      <span class="mapper-label" style="font-weight: 500; color: var(--text-primary); flex: 1;">Columna ${index + 1}: <strong>${header}</strong></span>
      <span class="mapper-arrow" style="color: var(--text-muted); margin: 0 8px;">➔</span>
      <select class="input-field column-map-select" data-col-index="${index}" style="background-color: var(--bg-surface); max-width: 250px; margin: 0;">
        <option value="ignore">⚙️ Importar como campo adicional</option>
        <option value="name">👤 Nombre Completo *</option>
        <option value="company">🏢 Empresa / Negocio</option>
        <option value="email">✉️ Correo Electrónico</option>
        <option value="phone">📞 Teléfono / Celular</option>
        <option value="website">🌐 Sitio Web</option>
        <option value="socials">📸 Redes Sociales</option>
        <option value="notes">📝 Notas / Comentarios</option>
      </select>
    `;

    const select = rowDiv.querySelector('.column-map-select');
    const detectedField = detectFieldForHeader(header);

    if (savedHeaderMapping && savedHeaderMapping[header] !== undefined) {
      select.value = savedHeaderMapping[header];
    } else {
      select.value = detectedField;
    }

    container.appendChild(rowDiv);
  });
}


async function renderImportPreview() {
  const previewCard = document.getElementById('preview-card');
  const tbody = document.getElementById('preview-table-body');
  const summaryText = document.getElementById('preview-summary');

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Procesando leads...</td></tr>';
  previewCard.style.display = 'block';
  previewCard.scrollIntoView({ behavior: 'smooth' });

  try {
    const processed = await processImportedRows(parsedCsvData, currentMapping);
    
    if (processed.leads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Ningún lead válido detectado en las filas. Comprueba las columnas mapeadas.</td></tr>';
      summaryText.textContent = '0 Leads detectados';
      document.getElementById('btn-import-execute').disabled = true;
      return;
    }

    const totalCount = processed.leads.length;
    const existsCount = processed.leads.filter(l => l.exists).length;
    const newCount = totalCount - existsCount;

    summaryText.innerHTML = `<strong>${newCount}</strong> nuevos, <strong>${existsCount}</strong> ya en seguimiento (Total: ${totalCount})`;
    document.getElementById('btn-import-execute').disabled = newCount === 0;

    tbody.innerHTML = processed.leads.map(lead => {
      return `
        <tr class="${lead.exists ? 'lead-exists' : ''}">
          <td style="font-weight:600">${lead.name}</td>
          <td>${lead.company || '<span style="color:var(--text-muted)">-</span>'}</td>
          <td>${lead.email || '<span style="color:var(--text-muted)">-</span>'}</td>
          <td>${lead.phone || '<span style="color:var(--text-muted)">-</span>'}</td>
          <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${lead.initialNotes || ''}">${lead.initialNotes || '<span style="color:var(--text-muted)">-</span>'}</td>
          <td>
            ${lead.exists 
              ? `<span class="status-badge exists">Seguimiento Activo</span>` 
              : `<span class="status-badge new">Nuevo</span>`
            }
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--accent-red)">Error al generar la previsualización.</td></tr>';
  }
}

/* ==========================================================================
   SETTINGS & DEMO LOADER UI LOGIC
   ========================================================================== */

function setupSettingsUI() {
  const loadDemoBtn = document.getElementById('btn-load-demo');
  const exportBtn = document.getElementById('btn-export-db');
  const importInput = document.getElementById('btn-import-db-input');

  // Load demo data
  loadDemoBtn.addEventListener('click', async () => {
    if (confirm('¿Quieres cargar los datos de demostración? Esto reemplazará toda tu base de datos actual.')) {
      await loadDemoData(true);
    }
  });

  // Export database
  exportBtn.addEventListener('click', async () => {
    try {
      const dump = await exportDatabase();
      const jsonString = JSON.stringify(dump, null, 2);
      
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `gespropec_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Error al exportar base de datos.');
    }
  });

  // Import database file selection
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        
        if (confirm('¿Restaurar copia de seguridad? Esto SOBREESCRIBIRÁ todos tus datos actuales de forma permanente.')) {
          const summary = await importDatabase(backupData);
          alert(`Copia de seguridad restaurada con éxito:\n- ${summary.leadsCount} leads importados\n- ${summary.logsCount} registros de historial\n- ${summary.remindersCount} tareas agendadas.`);
          
          await handleDatabaseUpdate();
        }
      } catch (err) {
        alert('Error al importar copia de seguridad: Archivo JSON no válido o corrupto.');
        console.error(err);
      } finally {
        importInput.value = ''; // Reset input picker
      }
    };
    reader.readAsText(file);
  });

  // Gemini API Key Logic
  const geminiKeyInput = document.getElementById('settings-gemini-key');
  const toggleVisibilityBtn = document.getElementById('btn-toggle-gemini-visibility');
  const saveAiBtn = document.getElementById('btn-save-ai-settings');

  if (geminiKeyInput) {
    geminiKeyInput.value = localStorage.getItem('gespropec_gemini_api_key') || '';
  }

  if (toggleVisibilityBtn && geminiKeyInput) {
    toggleVisibilityBtn.addEventListener('click', () => {
      if (geminiKeyInput.type === 'password') {
        geminiKeyInput.type = 'text';
        toggleVisibilityBtn.textContent = '🔒';
      } else {
        geminiKeyInput.type = 'password';
        toggleVisibilityBtn.textContent = '👁️';
      }
    });
  }

  if (saveAiBtn && geminiKeyInput) {
    saveAiBtn.addEventListener('click', () => {
      const key = geminiKeyInput.value.trim();
      localStorage.setItem('gespropec_gemini_api_key', key);
      alert('Configuración de API Key guardada con éxito.');
    });
  }
}

// Populate DB helper
async function loadDemoData(showAlert = true) {
  try {
    const backupFormat = {
      version: 1,
      data: {
        leads: mockLeads,
        logs: mockLogs,
        reminders: mockReminders
      }
    };

    await importDatabase(backupFormat);
    
    if (showAlert) {
      alert('¡Base de datos de demostración cargada con éxito!');
    }

    await handleDatabaseUpdate();
  } catch (error) {
    console.error('Failed to load demo:', error);
    if (showAlert) {
      alert('Error al cargar base de datos de demostración.');
    }
  }
}

/* ==========================================================================
   QUICK ADD MANUAL CONTACTS UI LOGIC
   ========================================================================== */

function setupQuickAddUI() {
  const triggerBtn = document.getElementById('btn-quick-add-lead');
  const backdrop = document.getElementById('quick-add-modal-backdrop');
  const cancelBtn = document.getElementById('btn-cancel-quick-add');
  const form = document.getElementById('form-quick-add-lead');

  const openModal = () => {
    backdrop.classList.add('active');
    document.getElementById('quick-add-name').focus();
  };

  const closeModal = () => {
    backdrop.classList.remove('active');
    form.reset();
  };

  triggerBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  
  // Close on clicking backdrop
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeModal();
    }
  });

  // Submit manual form
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('quick-add-name').value.trim();
    const company = document.getElementById('quick-add-company').value.trim();
    const email = document.getElementById('quick-add-email').value.trim();
    const phone = document.getElementById('quick-add-phone').value.trim();
    const website = document.getElementById('quick-add-website').value.trim();
    const socials = document.getElementById('quick-add-socials').value.trim();
    const agent = document.getElementById('quick-add-agent').value;

    try {
      const newLead = {
        id: 'lead-' + Date.now(),
        name,
        company,
        email,
        phone,
        website,
        socials,
        agent,
        status: 'new' // Start as New column
      };

      await addLead(newLead);
      await addLog(newLead.id, 'system', 'Contacto creado manualmente en GesPropec.');

      closeModal();
      
      // Auto open lead details drawer immediately so they can add notes or tasks right away!
      // This is a premium UX touch!
      openLeadDrawer(newLead.id);

      // Refresh current views
      await handleDatabaseUpdate();

    } catch (err) {
      console.error(err);
      alert('Error al agregar el prospecto.');
    }
  });
}

/* ==========================================================================
   CLIENTS SECTION UI LOGIC
   ========================================================================== */

function setupClientsUI() {
  const addClientBtn = document.getElementById('btn-add-client-manual');
  const backdrop = document.getElementById('client-add-modal-backdrop');
  const cancelBtn = document.getElementById('btn-cancel-client-add');
  const form = document.getElementById('form-client-add');
  const searchInput = document.getElementById('search-clients-input');

  const openModal = () => {
    backdrop.classList.add('active');
    document.getElementById('client-add-name').focus();
  };

  const closeModal = () => {
    backdrop.classList.remove('active');
    form.reset();
  };

  if (addClientBtn) addClientBtn.addEventListener('click', openModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
  }

  // Search input filtering
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderClientsTable(searchInput.value.trim());
    });
  }

  // Submit manual client form
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('client-add-name').value.trim();
      const company = document.getElementById('client-add-company').value.trim();
      const email = document.getElementById('client-add-email').value.trim();
      const phone = document.getElementById('client-add-phone').value.trim();
      const website = document.getElementById('client-add-website').value.trim();
      const socials = document.getElementById('client-add-socials').value.trim();
      const agent = document.getElementById('client-add-agent').value;

      try {
        const newClient = {
          id: 'lead-' + Date.now(),
          name,
          company,
          email,
          phone,
          website,
          socials,
          agent,
          status: 'won' // Direct Client status
        };

        await addLead(newClient);
        await addLog(newClient.id, 'system', 'Cliente registrado manualmente en la cartera de clientes.');

        closeModal();
        
        // Auto open details drawer
        openLeadDrawer(newClient.id);

        // Refresh current views
        await handleDatabaseUpdate();

      } catch (err) {
        console.error(err);
        alert('Error al registrar el cliente.');
      }
    });
  }
}

async function renderClientsTable(searchQuery = '') {
  const tbody = document.getElementById('clients-table-body');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Cargando clientes...</td></tr>';

  try {
    const leads = await getLeadsFilteredByAgent();
    
    // Filter by clients (status 'won')
    let clients = leads.filter(l => l.status === 'won');

    // Filter by search query if any
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      clients = clients.filter(c => 
        c.name.toLowerCase().includes(q) || 
        (c.company && c.company.toLowerCase().includes(q)) || 
        (c.email && c.email.toLowerCase().includes(q))
      );
    }

    if (clients.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color:var(--text-muted); padding:32px 0;">
            ${searchQuery ? 'No se encontraron clientes que coincidan con la búsqueda.' : 'No tienes clientes registrados en tu cartera todavía.'}
          </td>
        </tr>
      `;
      return;
    }

    // Sort: updated descending
    clients.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    tbody.innerHTML = clients.map(client => {
      const formattedDate = new Date(client.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      return `
        <tr>
          <td style="font-weight:600; color:var(--text-primary);">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:16px;">👤</span>
              <span>${client.name}</span>
            </div>
          </td>
          <td>${client.company || '<span style="color:var(--text-muted)">-</span>'}</td>
          <td>
            <div style="display:flex; flex-direction:column; gap:2px; font-size:12px;">
              ${client.email ? `<span>✉️ ${client.email}</span>` : ''}
              ${client.phone ? `<span>📞 ${client.phone}</span>` : ''}
              ${!client.email && !client.phone ? '<span style="color:var(--text-muted)">Sin contacto</span>' : ''}
            </div>
          </td>
          <td>${formattedDate}</td>
          <td style="text-align:right;">
            <div style="display:flex; gap:8px; justify-content:flex-end; align-items:center;">
              <select class="input-field row-status-select" data-id="${client.id}" style="padding:4px 8px; font-size:12px; width:auto; height:auto; margin:0; background-color: var(--bg-surface);">
                <option value="won" selected>Cliente Activo</option>
                <option value="contacted">Mover a Seguimiento</option>
                <option value="lost">Descartar Cliente</option>
              </select>
              <button class="btn btn-secondary btn-view-client-drawer" data-id="${client.id}" title="Ver Ficha de Seguimiento" style="padding: 4px 10px; font-size:12px;">
                👁️ Ficha
              </button>
              <button class="btn btn-secondary btn-edit-client" data-id="${client.id}" title="Editar Información" style="padding: 4px 10px; font-size:12px; color: var(--accent-purple); border-color: rgba(124, 58, 237, 0.2);">
                ✏️ Editar
              </button>
              <button class="btn btn-secondary btn-delete-client" data-id="${client.id}" title="Eliminar Cliente" style="padding: 4px 10px; font-size:12px; color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);">
                🗑️ Borrar
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row events
    tbody.querySelectorAll('.btn-view-client-drawer').forEach(btn => {
      btn.addEventListener('click', () => {
        openLeadDrawer(btn.dataset.id, 'tab-history');
      });
    });

    tbody.querySelectorAll('.btn-edit-client').forEach(btn => {
      btn.addEventListener('click', () => {
        openLeadDrawer(btn.dataset.id, 'tab-info');
      });
    });

    tbody.querySelectorAll('.btn-delete-client').forEach(btn => {
      btn.addEventListener('click', async () => {
        const leadId = btn.dataset.id;
        const client = clients.find(c => c.id === leadId);
        if (!client) return;

        if (confirm(`¿Estás seguro de que deseas eliminar permanentemente al cliente "${client.name}"? Se perderá todo su historial, notas y recordatorios del calendario.`)) {
          try {
            await deleteLead(leadId);
            alert('Cliente eliminado correctamente.');
            await handleDatabaseUpdate();
          } catch (err) {
            console.error(err);
            alert('Error al eliminar el cliente.');
          }
        }
      });
    });

    tbody.querySelectorAll('.row-status-select').forEach(select => {
      select.addEventListener('change', async () => {
        const leadId = select.dataset.id;
        const newStatus = select.value;
        if (newStatus === 'won') return;

        try {
          const lead = leads.find(l => l.id === leadId);
          if (lead) {
            const oldStatusName = STAGES[lead.status]?.label || lead.status;
            const newStatusName = STAGES[newStatus]?.label;
            lead.status = newStatus;

            await updateLead(lead);
            await addLog(lead.id, 'system', `Estado cambiado desde tabla Clientes: de "${oldStatusName}" a "${newStatusName}"`);
            
            alert(`Cliente movido a la etapa "${newStatusName}" con éxito.`);
            await handleDatabaseUpdate();
          }
        } catch (err) {
          console.error(err);
          alert('Error al actualizar el estado.');
        }
      });
    });

  } catch (error) {
    console.error('Error rendering clients list:', error);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--accent-red)">Error al cargar el listado.</td></tr>';
  }
}

function setupAgentFilterUI() {
  const pills = document.querySelectorAll('.agent-pill');
  if (pills.length === 0) return;

  // Read initial active agents list from storage, default to all if not set
  let activeAgents = ['jordan', 'sandra', 'unassigned'];
  const saved = localStorage.getItem('gespropec_active_agents');
  if (saved) {
    try {
      activeAgents = JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }

  // Update visual state of pills
  pills.forEach(pill => {
    const agent = pill.dataset.agent;
    if (activeAgents.includes(agent)) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  // Attach click toggle listeners
  pills.forEach(pill => {
    pill.addEventListener('click', async () => {
      pill.classList.toggle('active');
      
      const newActiveAgents = [];
      pills.forEach(p => {
        if (p.classList.contains('active')) {
          newActiveAgents.push(p.dataset.agent);
        }
      });

      // If both are selected (or both deselected), include 'unassigned' as well.
      // If only one is selected, do not include unassigned.
      if (newActiveAgents.length === 2 || newActiveAgents.length === 0) {
        newActiveAgents.push('unassigned');
      }

      localStorage.setItem('gespropec_active_agents', JSON.stringify(newActiveAgents));

      // Trigger views refresh
      await handleDatabaseUpdate();
    });
  });
}

async function autoAssignAgentsToExistingLeads() {
  const leads = await getAllLeads();
  let updatedCount = 0;
  
  for (const lead of leads) {
    if (!lead.agent || lead.agent === 'unassigned') {
      let assignedAgent = 'unassigned';
      
      const textToSearch = [
        lead.name,
        lead.company,
        lead.website,
        lead.socials,
        JSON.stringify(lead.customFields || {}),
        lead.sector,
        lead.entity_plural
      ].join(' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      if (
        textToSearch.includes('canin') || 
        textToSearch.includes('perro') || 
        textToSearch.includes('dog') || 
        textToSearch.includes('mascota') || 
        textToSearch.includes('veterinari') ||
        textToSearch.includes('grooming')
      ) {
        assignedAgent = 'jordan';
      } else if (
        textToSearch.includes('corredur') || 
        textToSearch.includes('segur') || 
        textToSearch.includes('broker') || 
        textToSearch.includes('mutua') || 
        textToSearch.includes('ksm') ||
        textToSearch.includes('asegur')
      ) {
        assignedAgent = 'sandra';
      }
      
      if (assignedAgent !== 'unassigned') {
        lead.agent = assignedAgent;
        await updateLead(lead);
        updatedCount++;
      }
    }
  }
  
  if (updatedCount > 0) {
    console.log(`Auto-assigned ${updatedCount} leads to agents based on keywords.`);
  }
}
