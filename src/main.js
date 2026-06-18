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
  importDatabase,
  getDefaultPipelineStateFromStatus
} from './db.js';
import { initBoard, renderBoard, STAGES } from './components/board.js';
import { initLeadModal, openLeadDrawer } from './components/leadModal.js';
import { initNotifications, refreshNotifications } from './components/notifications.js';
import { initCalendar, renderCalendar } from './calendar.js';
import { renderDashboard } from './dashboard.js';
import { initList, renderList, syncGoogleSheetsLeads } from './components/list.js';
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
document.addEventListener('DOMContentLoaded', () => {
  // Global custom listeners (set up once)
  document.addEventListener('database-updated', handleDatabaseUpdate);
  document.addEventListener('open-lead-detail', (e) => {
    if (e.detail) {
      handleLeadClick(e.detail);
    }
  });

  setupLoginGate();
});

async function initCRM() {
  const loginLayout = document.getElementById('login-layout');
  const crmLayout = document.getElementById('crm-layout');
  if (loginLayout) loginLayout.style.display = 'none';
  if (crmLayout) crmLayout.style.display = 'flex';

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
    
    // 6. Initial load
    switchView('dashboard');
    await refreshNotifications();
    initPrivacyConsent();

    // Background sync on boot
    syncGoogleSheetsLeads().then(({ countAdded, countUpdated }) => {
      if (countAdded > 0 || countUpdated > 0) {
        handleDatabaseUpdate();
      }
    }).catch(err => console.error('Initial sync failed:', err));

    // Background Google Drive pull on boot
    const isAutoSync = localStorage.getItem('gespropec_google_auto_sync') === 'true';
    const token = localStorage.getItem('gespropec_google_access_token');
    if (isAutoSync && token) {
      loadFromGoogleDrive(token).then((syncedAt) => {
        if (syncedAt) {
          const timeStr = new Date(syncedAt).toLocaleTimeString();
          const label = document.getElementById('google-last-sync-label');
          if (label) label.textContent = `Última sincronización: Hoy a las ${timeStr} (Auto)`;
          localStorage.setItem('gespropec_google_last_sync', `Hoy a las ${timeStr} (Auto)`);
          refreshCurrentView();
          refreshNotifications();
        }
      }).catch(err => console.warn('[Auto Pull Boot] Failed:', err));
    }

  } catch (error) {
    console.error('App boot failure:', error);
  }
}

function setupLoginGate() {
  const loginLayout = document.getElementById('login-layout');
  const crmLayout = document.getElementById('crm-layout');
  const token = localStorage.getItem('gespropec_google_access_token');
  const email = localStorage.getItem('google_user_email');
  
  // Authorized emails list (Jordan only)
  const authorizedEmails = ['makebyjordan@gmail.com'];

  if (token && email && authorizedEmails.includes(email.toLowerCase())) {
    // User is already logged in with authorized email
    // Automatically set their active agent
    setActiveAgentFromEmail(email.toLowerCase());
    initCRM();
  } else {
    // Show login screen
    if (loginLayout) loginLayout.style.display = 'flex';
    if (crmLayout) crmLayout.style.display = 'none';
    
    const clientIdInput = document.getElementById('login-google-client-id');
    const loginBtn = document.getElementById('btn-login-google');
    
    // Pre-fill client ID
    if (clientIdInput) {
      clientIdInput.value = localStorage.getItem('gespropec_google_client_id') || '207858491722-qf2tg9nttj3koj90cuosqd47o82rfes0.apps.googleusercontent.com';
    }
    
    if (loginBtn) {
      loginBtn.onclick = () => {
        const clientId = clientIdInput ? clientIdInput.value.trim() : '';
        if (!clientId) {
          alert('Por favor, introduce tu Google OAuth Client ID.');
          return;
        }
        
        localStorage.setItem('gespropec_google_client_id', clientId);
        
        try {
          if (typeof google === 'undefined') {
            alert('La librería de Google no se ha cargado. Verifica tu conexión a internet.');
            return;
          }

          const client = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.appdata email profile',
            callback: async (tokenResponse) => {
              if (tokenResponse.error) {
                alert('Error al iniciar sesión con Google: ' + tokenResponse.error_description);
                return;
              }
              
              if (tokenResponse.access_token) {
                const accessToken = tokenResponse.access_token;
                
                try {
                  const userInfo = await fetchGoogleUserInfo(accessToken);
                  if (userInfo && userInfo.email) {
                    const userEmail = userInfo.email.toLowerCase();
                    
                    if (authorizedEmails.includes(userEmail)) {
                      localStorage.setItem('gespropec_google_access_token', accessToken);
                      localStorage.setItem('google_user_name', userInfo.name || userInfo.given_name || 'Usuario');
                      localStorage.setItem('google_user_email', userEmail);
                      localStorage.setItem('google_user_avatar', userInfo.picture || '');
                      
                      setActiveAgentFromEmail(userEmail);
                      
                      alert('Inicio de sesión exitoso.');
                      initCRM();
                    } else {
                      alert(`Acceso denegado: El correo ${userEmail} no está autorizado para acceder a GesPropec.`);
                      localStorage.removeItem('gespropec_google_access_token');
                    }
                  } else {
                    alert('No se pudo verificar el correo electrónico del perfil de Google.');
                  }
                } catch (profileErr) {
                  console.error('Error fetching profile:', profileErr);
                  alert('Error al obtener la información de perfil de Google.');
                }
              }
            },
          });
          
          client.requestAccessToken({ prompt: 'consent' });
        } catch (err) {
          console.error(err);
          alert('Ocurrió un error al inicializar el login de Google.');
        }
      };
    }
  }
}

function setActiveAgentFromEmail(email) {
  localStorage.setItem('gespropec_active_agents', JSON.stringify(['jordan']));
}

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
  
  // Auto-sync if enabled and connected
  const isAutoSync = localStorage.getItem('gespropec_google_auto_sync') === 'true';
  const token = localStorage.getItem('gespropec_google_access_token');
  if (isAutoSync && token) {
    syncToGoogleDrive(token)
      .then(() => {
        const timeStr = new Date().toLocaleTimeString();
        const label = document.getElementById('google-last-sync-label');
        if (label) label.textContent = `Última sincronización: Hoy a las ${timeStr} (Auto)`;
        localStorage.setItem('gespropec_google_last_sync', `Hoy a las ${timeStr} (Auto)`);
      })
      .catch(err => {
        console.warn('[Auto Sync] Failed:', err);
      });
  }
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

  if (viewName === 'lista') {
    syncGoogleSheetsLeads().then(({ countAdded, countUpdated }) => {
      if (countAdded > 0 || countUpdated > 0) {
        handleDatabaseUpdate();
      }
    }).catch(err => console.error('Lista sync failed:', err));
  }
}

/* ==========================================================================
   GOOGLE SHEETS IMPORTER UI LOGIC
   ========================================================================== */

function setupImporterUI() {
  const urlTabBtn = document.getElementById('btn-import-url-tab');
  const fileTabBtn = document.getElementById('btn-import-file-tab');
  const urlPane = document.getElementById('import-url-pane');
  const filePane = document.getElementById('import-file-pane');

  const fetchBtn = document.getElementById('btn-fetch-sheets');
  const fileInput = document.getElementById('import-csv-file');
  const sheetUrlInput = document.getElementById('import-sheets-url');

  const mapperCard = document.getElementById('mapper-card');
  const previewCard = document.getElementById('preview-card');
  const defaultAgentSelect = document.getElementById('import-default-agent');

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
      // Pass the URL directly — fetchCSV extracts gid from the URL automatically
      const rows = parseCSV(await fetchCSV(url));

      if (rows.length < 2) throw new Error('La hoja está vacía o no tiene el formato correcto.');
      parsedCsvData = rows;

      setupMapperOptions(parsedCsvData[0]);

      // Sync default agent selection
      if (defaultAgentSelect) {
        defaultAgentSelect.value = 'jordan';
      }

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

  // ── Core import function (used by import buttons) ───────────────────────
  async function executeImport(overrideMode) {
    const executeBtn    = document.getElementById('btn-import-execute');
    const autoBtn       = document.getElementById('btn-import-auto-assign');
    const listaBtn      = document.getElementById('btn-import-to-lista');
    const allBtns       = [executeBtn, autoBtn, listaBtn];

    allBtns.forEach(b => { if (b) b.disabled = true; });
    if (overrideMode === 'lista') {
      if (listaBtn) listaBtn.innerHTML = '⏳ Añadiendo…';
    } else {
      if (executeBtn) executeBtn.textContent = 'Importando…';
    }

    try {
      const processed  = await processImportedRows(parsedCsvData, currentMapping);
      const toImport   = processed.leads.filter(l => !l.exists);

      if (toImport.length === 0) {
        alert('No hay leads nuevos para importar. Todos los contactos ya están en seguimiento.');
        return;
      }

      const selectorAgent  = document.getElementById('import-default-agent')?.value || 'unassigned';

      let count = 0;
      for (const lead of toImport) {
        let assignedAgent = 'unassigned';

        if (overrideMode === 'lista') {
          assignedAgent = 'unassigned';
        } else {
          // If the lead itself contains 'jordan' (or previously sandra which gets parsed as jordan)
          if (lead.agent === 'jordan' || lead.agent === 'sandra') {
            assignedAgent = 'jordan';
          } else if (selectorAgent === 'jordan') {
            assignedAgent = 'jordan';
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

      const modeLabel = overrideMode === 'lista' ? 'añadidos a la Lista' : 'pasados a Seguimiento';
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
      if (listaBtn)   listaBtn.innerHTML = `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 6h18M3 14h18M3 18h18"/></svg> Añadir a Lista`;
    }
  }

  // Button handlers
  document.getElementById('btn-import-execute')
    .addEventListener('click', () => executeImport(null));

  const autoAssignBtn = document.getElementById('btn-import-auto-assign');
  if (autoAssignBtn) {
    autoAssignBtn.addEventListener('click', () => executeImport('auto'));
  }

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

  // ── GOOGLE DRIVE SYNC LOGIC ───────────────────────────────────
  const googleClientIdInput = document.getElementById('settings-google-client-id');
  const googleLoginBtn = document.getElementById('btn-google-login');
  const googleLogoutBtn = document.getElementById('btn-google-logout');
  const googlePushBtn = document.getElementById('btn-google-sync-push');
  const googlePullBtn = document.getElementById('btn-google-sync-pull');
  const googleAutoSyncChk = document.getElementById('settings-google-auto-sync');

  updateGoogleSyncUI();

  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => {
      const clientId = googleClientIdInput ? googleClientIdInput.value.trim() : '';
      if (!clientId) {
        alert('Por favor, introduce tu Google OAuth Client ID.');
        return;
      }
      
      localStorage.setItem('gespropec_google_client_id', clientId);
      
      try {
        if (typeof google === 'undefined') {
          alert('La librería de Google no se ha cargado. Verifica tu conexión a internet.');
          return;
        }

        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive email profile',
          callback: async (tokenResponse) => {
            if (tokenResponse.error) {
              alert('Error al iniciar sesión con Google: ' + tokenResponse.error_description);
              return;
            }
            
            if (tokenResponse.access_token) {
              const token = tokenResponse.access_token;
              localStorage.setItem('gespropec_google_access_token', token);
              
              // Fetch profile info
              try {
                const userInfo = await fetchGoogleUserInfo(token);
                if (userInfo) {
                  localStorage.setItem('google_user_name', userInfo.name || userInfo.given_name || 'Usuario');
                  localStorage.setItem('google_user_email', userInfo.email);
                  localStorage.setItem('google_user_avatar', userInfo.picture || '');
                }
                
                alert('Conexión con Google exitosa.');
                updateGoogleSyncUI();
              } catch (profileErr) {
                console.error('Error fetching google profile info:', profileErr);
                alert('Sesión iniciada, pero no pudimos cargar los detalles del perfil.');
                updateGoogleSyncUI();
              }
            }
          },
        });
        
        client.requestAccessToken({ prompt: 'consent' });
      } catch (err) {
        console.error(err);
        alert('Ocurrió un error al inicializar el login de Google.');
      }
    });
  }

  if (googleLogoutBtn) {
    googleLogoutBtn.addEventListener('click', () => {
      localStorage.removeItem('gespropec_google_access_token');
      localStorage.removeItem('google_user_name');
      localStorage.removeItem('google_user_email');
      localStorage.removeItem('google_user_avatar');
      localStorage.removeItem('gespropec_google_file_id');
      alert('Sesión de Google cerrada.');
      updateGoogleSyncUI();

      // Hide CRM layout and show Login gate
      const loginLayout = document.getElementById('login-layout');
      const crmLayout = document.getElementById('crm-layout');
      if (loginLayout) loginLayout.style.display = 'flex';
      if (crmLayout) crmLayout.style.display = 'none';
      setupLoginGate();
    });
  }

  if (googlePushBtn) {
    googlePushBtn.addEventListener('click', async () => {
      const token = localStorage.getItem('gespropec_google_access_token');
      if (!token) return;
      
      googlePushBtn.disabled = true;
      googlePushBtn.textContent = '📤 Guardando...';
      
      try {
        await syncToGoogleDrive(token);
        const timeStr = new Date().toLocaleTimeString();
        localStorage.setItem('gespropec_google_last_sync', `Hoy a las ${timeStr} (Manual)`);
        alert('Copia de seguridad guardada con éxito en tu Google Drive.');
        updateGoogleSyncUI();
      } catch (err) {
        console.error(err);
        alert('Error al guardar en Google Drive.');
      } finally {
        googlePushBtn.disabled = false;
        googlePushBtn.textContent = '📤 Guardar en Drive';
      }
    });
  }

  if (googlePullBtn) {
    googlePullBtn.addEventListener('click', async () => {
      const token = localStorage.getItem('gespropec_google_access_token');
      if (!token) return;
      
      if (!confirm('¿Quieres descargar y restaurar los datos de tu cuenta de Google Drive? Esto SOBREESCRIBIRÁ todos tus datos locales actuales.')) {
        return;
      }
      
      googlePullBtn.disabled = true;
      googlePullBtn.textContent = '📥 Cargando...';
      
      try {
        const syncedAt = await loadFromGoogleDrive(token);
        if (syncedAt) {
          const dateStr = new Date(syncedAt).toLocaleString();
          alert(`Datos restaurados con éxito. Copia del: ${dateStr}. La página se actualizará.`);
          localStorage.setItem('gespropec_google_last_sync', `Descargado (Copia del ${dateStr})`);
          await handleDatabaseUpdate();
        } else {
          alert('No se encontró ninguna copia de seguridad en tu Google Drive para esta aplicación.');
        }
        updateGoogleSyncUI();
      } catch (err) {
        console.error(err);
        alert('Error al descargar desde Google Drive.');
      } finally {
        googlePullBtn.disabled = false;
        googlePullBtn.textContent = '📥 Cargar de Drive';
      }
    });
  }

  if (googleAutoSyncChk) {
    googleAutoSyncChk.addEventListener('change', () => {
      localStorage.setItem('gespropec_google_auto_sync', googleAutoSyncChk.checked ? 'true' : 'false');
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
        status: 'new', // Start as New column
        pipelineState: ''
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
          status: 'won', // Direct Client status
          pipelineState: 'firmado'
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
    
    // Filter by active clients/leads (status not new, lost, or archived)
    let clients = leads.filter(l => l.status !== 'new' && l.status !== 'lost' && l.status !== 'archived');

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
            ${searchQuery ? 'No se encontraron clientes que coincidan con la búsqueda.' : 'No tienes clientes o prospectos activos en tu cartera todavía.'}
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
                <option value="won" ${client.status === 'won' ? 'selected' : ''}>Cliente Activo</option>
                <option value="contacted" ${client.status === 'contacted' ? 'selected' : ''}>Mover a Seguimiento</option>
                <option value="lost" ${client.status === 'lost' ? 'selected' : ''}>Descartar Cliente</option>
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
        const lead = clients.find(l => l.id === leadId);
        if (!lead || newStatus === lead.status) return;

        try {
          const oldStatusName = STAGES[lead.status]?.label || lead.status;
          const newStatusName = STAGES[newStatus]?.label;
          lead.status = newStatus;

          // Sincronizar pipelineState
          const prevPipeline = lead.pipelineState || '';
          const newPipeline = getDefaultPipelineStateFromStatus(newStatus);
          if (prevPipeline !== newPipeline) {
            lead.pipelineState = newPipeline;
            await addLog(lead.id, 'system', `Fase de seguimiento cambiada automáticamente a "${newPipeline || 'ninguno'}" desde Clientes.`);
          }

          await updateLead(lead);
          await addLog(lead.id, 'system', `Estado cambiado desde tabla Clientes: de "${oldStatusName}" a "${newStatusName}"`);
          
          alert(`Cliente movido a la etapa "${newStatusName}" con éxito.`);
          await handleDatabaseUpdate();
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

  // Read initial active agents list from storage, default to jordan/unassigned
  let activeAgents = ['jordan', 'unassigned'];
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

      if (!newActiveAgents.includes('jordan')) {
        newActiveAgents.push('jordan');
      }
      if (!newActiveAgents.includes('unassigned')) {
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
    let changed = false;
    
    // Migrate Sandra leads to Jordan to avoid data invisibility
    if (lead.agent === 'sandra') {
      lead.agent = 'jordan';
      changed = true;
    }
    
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
        textToSearch.includes('grooming') ||
        textToSearch.includes('corredur') || 
        textToSearch.includes('segur') || 
        textToSearch.includes('broker') || 
        textToSearch.includes('mutua') || 
        textToSearch.includes('ksm') ||
        textToSearch.includes('asegur')
      ) {
        assignedAgent = 'jordan';
      }
      
      if (assignedAgent !== 'unassigned') {
        lead.agent = assignedAgent;
        changed = true;
      }
    }
    
    if (changed) {
      await updateLead(lead);
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    console.log(`Auto-assigned/Migrated ${updatedCount} leads to Jordan.`);
  }
}

function initPrivacyConsent() {
  if (localStorage.getItem('gespropec_privacy_consent')) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'privacy-consent-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    max-width: 400px;
    width: calc(100% - 48px);
    background: rgba(15, 15, 22, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
    z-index: 99999;
    opacity: 0;
    transform: translateY(100px);
    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
  `;

  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 480px) {
      #privacy-consent-banner {
        right: 16px !important;
        left: 16px !important;
        bottom: 16px !important;
        width: auto !important;
        max-width: none !important;
        padding: 16px !important;
      }
    }
  `;
  document.head.appendChild(style);

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="
        font-size: 20px;
        background: rgba(124, 58, 237, 0.15);
        padding: 6px;
        border-radius: 8px;
        display: inline-flex;
      ">🛡️</span>
      <h4 style="
        margin:0;
        font-family: var(--font-heading, sans-serif);
        font-size:16px;
        font-weight:600;
        color:var(--text-primary, #fff);
      ">Políticas de Privacidad y Cookies</h4>
    </div>
    
    <p style="
      margin: 0 0 20px;
      font-size:13px;
      line-height:1.5;
      color: var(--text-secondary, #94a3b8);
    ">
      Utilizamos cookies propias y de terceros para optimizar el rendimiento de la aplicación CRM y personalizar tu experiencia de usuario. Consulta nuestras políticas y selecciona tus opciones.
    </p>

    <div id="privacy-config-panel" style="
      display: none;
      border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));
      padding-top: 16px;
      margin-bottom: 20px;
      animation: fadeIn 0.2s ease;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <strong style="font-size:12px;color:var(--text-primary);">Cookies Necesarias</strong>
          <p style="margin:2px 0 0;font-size:11px;color:var(--text-muted);">Esenciales para el funcionamiento del CRM.</p>
        </div>
        <input type="checkbox" checked disabled style="accent-color:var(--accent-purple);width:16px;height:16px;">
      </div>
      
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <strong style="font-size:12px;color:var(--text-primary);">Analíticas e Informes</strong>
          <p style="margin:2px 0 0;font-size:11px;color:var(--text-muted);">Nos permiten medir el uso de las funciones.</p>
        </div>
        <input type="checkbox" id="privacy-chk-analytics" checked style="accent-color:var(--accent-purple);width:16px;height:16px;cursor:pointer;">
      </div>
      
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="font-size:12px;color:var(--text-primary);">Personalización</strong>
          <p style="margin:2px 0 0;font-size:11px;color:var(--text-muted);">Guarda filtros y layouts específicos.</p>
        </div>
        <input type="checkbox" id="privacy-chk-marketing" checked style="accent-color:var(--accent-purple);width:16px;height:16px;cursor:pointer;">
      </div>
    </div>

    <div id="privacy-main-buttons" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
      <button id="privacy-btn-config" style="
        background:none;border:1px solid var(--border-color, rgba(255,255,255,0.08));
        color:var(--text-secondary, #94a3b8);padding:8px 14px;border-radius:8px;
        font-size:12px;cursor:pointer;transition:all 0.15s;font-weight:500;
      ">Configurar</button>
      <button id="privacy-btn-reject" style="
        background:rgba(255, 255, 255, 0.03);border:1px solid var(--border-color, rgba(255,255,255,0.08));
        color:var(--text-secondary, #94a3b8);padding:8px 14px;border-radius:8px;
        font-size:12px;cursor:pointer;transition:all 0.15s;font-weight:500;
      ">Rechazar</button>
      <button id="privacy-btn-accept" style="
        background:var(--accent-purple, #7c3aed);border:none;
        color:#fff;padding:8px 16px;border-radius:8px;
        font-size:12px;cursor:pointer;transition:all 0.15s;font-weight:600;
        box-shadow: 0 4px 12px rgba(124, 58, 237, 0.2);
      ">Aceptar todo</button>
    </div>

    <div id="privacy-config-buttons" style="display:none;gap:8px;justify-content:flex-end;">
      <button id="privacy-btn-back" style="
        background:none;border:1px solid var(--border-color, rgba(255,255,255,0.08));
        color:var(--text-secondary, #94a3b8);padding:8px 14px;border-radius:8px;
        font-size:12px;cursor:pointer;transition:all 0.15s;font-weight:500;
      ">Volver</button>
      <button id="privacy-btn-save" style="
        background:var(--accent-purple, #7c3aed);border:none;
        color:#fff;padding:8px 16px;border-radius:8px;
        font-size:12px;cursor:pointer;transition:all 0.15s;font-weight:600;
        box-shadow: 0 4px 12px rgba(124, 58, 237, 0.2);
      ">Guardar selección</button>
    </div>
  `;

  document.body.appendChild(banner);

  setTimeout(() => {
    banner.style.opacity = '1';
    banner.style.transform = 'translateY(0)';
  }, 100);

  const hideBanner = () => {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(100px)';
    setTimeout(() => banner.remove(), 500);
  };

  document.getElementById('privacy-btn-accept').addEventListener('click', () => {
    localStorage.setItem('gespropec_privacy_consent', JSON.stringify({
      necessary: true,
      analytics: true,
      customization: true
    }));
    hideBanner();
  });

  document.getElementById('privacy-btn-reject').addEventListener('click', () => {
    localStorage.setItem('gespropec_privacy_consent', JSON.stringify({
      necessary: true,
      analytics: false,
      customization: false
    }));
    hideBanner();
  });

  const mainButtons = document.getElementById('privacy-main-buttons');
  const configButtons = document.getElementById('privacy-config-buttons');
  const configPanel = document.getElementById('privacy-config-panel');

  document.getElementById('privacy-btn-config').addEventListener('click', () => {
    mainButtons.style.display = 'none';
    configButtons.style.display = 'flex';
    configPanel.style.display = 'block';
  });

  document.getElementById('privacy-btn-back').addEventListener('click', () => {
    mainButtons.style.display = 'flex';
    configButtons.style.display = 'none';
    configPanel.style.display = 'none';
  });

  document.getElementById('privacy-btn-save').addEventListener('click', () => {
    const isAnalytics = document.getElementById('privacy-chk-analytics').checked;
    const isCustomization = document.getElementById('privacy-chk-marketing').checked;
    localStorage.setItem('gespropec_privacy_consent', JSON.stringify({
      necessary: true,
      analytics: isAnalytics,
      customization: isCustomization
    }));
    hideBanner();
  });

  const applyBtnEffects = (btnId, isPrimary) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('mouseenter', () => {
      if (isPrimary) {
        btn.style.background = '#8b5cf6';
        btn.style.transform = 'translateY(-1px)';
        btn.style.boxShadow = '0 6px 16px rgba(124, 58, 237, 0.35)';
      } else {
        btn.style.background = 'rgba(255, 255, 255, 0.08)';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (isPrimary) {
        btn.style.background = 'var(--accent-purple, #7c3aed)';
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.2)';
      } else {
        btn.style.background = btnId === 'privacy-btn-reject' ? 'rgba(255, 255, 255, 0.03)' : 'none';
        btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      }
    });
  };

  applyBtnEffects('privacy-btn-accept', true);
  applyBtnEffects('privacy-btn-reject', false);
  applyBtnEffects('privacy-btn-config', false);
  applyBtnEffects('privacy-btn-back', false);
  applyBtnEffects('privacy-btn-save', true);
}

/* ==========================================================================
   GOOGLE DRIVE BACKUP & SYNC FUNCTIONS
   ========================================================================== */

async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch user info');
  }
  return await res.json();
}

async function handleGoogleApiError(response) {
  if (response.status === 401) {
    localStorage.removeItem('gespropec_google_access_token');
    localStorage.removeItem('google_user_name');
    localStorage.removeItem('google_user_email');
    localStorage.removeItem('google_user_avatar');
    alert('Tu sesión de Google ha expirado. Por favor, vuelve a iniciar sesión.');
    updateGoogleSyncUI();
    throw new Error('Google session expired');
  }
}

async function syncToGoogleDrive(accessToken) {
  let localDb = await exportDatabase();

  const settings = {
    gespropec_list_columns_config: localStorage.getItem('gespropec_list_columns_config'),
    gespropec_column_widths: localStorage.getItem('gespropec_column_widths'),
    gespropec_expand_messages: localStorage.getItem('gespropec_expand_messages'),
    gespropec_gemini_api_key: localStorage.getItem('gespropec_gemini_api_key'),
    gespropec_active_agents: localStorage.getItem('gespropec_active_agents'),
  };
  
  const syncData = {
    db: localDb,
    settings: settings,
    syncedAt: new Date().toISOString()
  };
  
  const boundary = 'gespropec_multipart_boundary';
  const metadata = {
    name: 'gespropec_backup.json',
    mimeType: 'application/json',
    parents: ['appDataFolder']
  };
  
  const searchRes = await fetch('https://www.googleapis.com/drive/v3/files?q=name%3D%27gespropec_backup.json%27&spaces=appDataFolder', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (searchRes.status === 401) {
    await handleGoogleApiError(searchRes);
    return false;
  }
  
  const searchJson = await searchRes.json();
  const existingFile = searchJson.files && searchJson.files[0];
  
  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';
  
  if (existingFile) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`;
    method = 'PATCH';
  }
  
  const multipartBody = 
    `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    JSON.stringify(syncData) +
    `\r\n--${boundary}--`;
    
  const uploadRes = await fetch(url, {
    method: method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });
  
  if (!uploadRes.ok) {
    if (uploadRes.status === 401) {
      await handleGoogleApiError(uploadRes);
    }
    throw new Error('Sync failed: ' + uploadRes.statusText);
  }
  
  return true;
}

async function loadFromGoogleDrive(accessToken) {
  const searchRes = await fetch('https://www.googleapis.com/drive/v3/files?q=name%3D%27gespropec_backup.json%27&spaces=appDataFolder', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (searchRes.status === 401) {
    await handleGoogleApiError(searchRes);
    return null;
  }
  
  const searchJson = await searchRes.json();
  const file = searchJson.files && searchJson.files[0];
  
  if (!file) {
    return null;
  }
  
  const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!fileRes.ok) {
    if (fileRes.status === 401) {
      await handleGoogleApiError(fileRes);
    }
    throw new Error('Download failed: ' + fileRes.statusText);
  }
  
  const syncData = await fileRes.json();
  
  if (syncData.db) {
    await importDatabase(syncData.db);
  }
  
  if (syncData.settings) {
    Object.entries(syncData.settings).forEach(([key, val]) => {
      if (val !== null && val !== undefined) {
        localStorage.setItem(key, val);
      }
    });
  }
  
  return syncData.syncedAt;
}

function updateGoogleSyncUI() {
  const token = localStorage.getItem('gespropec_google_access_token');
  const loggedOutSec = document.getElementById('google-logged-out-section');
  const loggedInSec = document.getElementById('google-logged-in-section');
  const clientIdInput = document.getElementById('settings-google-client-id');
  
  if (clientIdInput) {
    clientIdInput.value = localStorage.getItem('gespropec_google_client_id') || '';
  }

  if (token) {
    if (loggedOutSec) loggedOutSec.style.display = 'none';
    if (loggedInSec) loggedInSec.style.display = 'flex';
    
    const avatar = document.getElementById('google-user-avatar');
    const name = document.getElementById('google-user-name');
    const email = document.getElementById('google-user-email');
    const lastSyncLabel = document.getElementById('google-last-sync-label');
    const autoSyncChk = document.getElementById('settings-google-auto-sync');
    
    if (avatar) avatar.src = localStorage.getItem('google_user_avatar') || '';
    if (name) name.textContent = localStorage.getItem('google_user_name') || 'Usuario';
    if (email) email.textContent = localStorage.getItem('google_user_email') || 'correo@gmail.com';
    
    const lastSync = localStorage.getItem('gespropec_google_last_sync') || 'Nunca';
    if (lastSyncLabel) lastSyncLabel.textContent = `Última sincronización: ${lastSync}`;
    
    if (autoSyncChk) {
      autoSyncChk.checked = localStorage.getItem('gespropec_google_auto_sync') === 'true';
    }
  } else {
    if (loggedOutSec) loggedOutSec.style.display = 'block';
    if (loggedInSec) loggedInSec.style.display = 'none';
  }
}

