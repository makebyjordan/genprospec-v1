import { Chart } from 'chart.js/auto';
import { getLeadsFilteredByAgent, getFilteredReminders } from './db.js';
import { STAGES } from './components/board.js';

let funnelChartInstance = null;
let responseChartInstance = null;

export async function renderDashboard(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const leads = await getLeadsFilteredByAgent();
    const reminders = await getFilteredReminders();

    // 1. Calculate KPI Metrics
    const totalLeads = leads.length;
    const activeLeads = leads.filter(l => ['contacted', 'no-response', 'interested', 'meeting'].includes(l.status)).length;
    const wonLeads = leads.filter(l => l.status === 'won').length;
    const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : 0;
    
    // Reminders for today
    const todayStr = new Date().toISOString().split('T')[0];
    const todayRemindersCount = reminders.filter(r => r.date === todayStr && r.status === 'pending').length;

    // Draw Dashboard structure
    container.innerHTML = `
      <!-- KPI Cards Grid -->
      <div class="grid-cols-4" style="margin-bottom: 32px;">
        <div class="glass-card kpi-card">
          <div class="kpi-icon blue">
            <svg style="width:24px;height:24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div class="kpi-info">
            <span class="kpi-label">Leads Totales</span>
            <span class="kpi-value">${totalLeads}</span>
          </div>
        </div>
        
        <div class="glass-card kpi-card">
          <div class="kpi-icon purple">
            <svg style="width:24px;height:24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div class="kpi-info">
            <span class="kpi-label">En Seguimiento</span>
            <span class="kpi-value">${activeLeads}</span>
          </div>
        </div>
        
        <div class="glass-card kpi-card">
          <div class="kpi-icon green">
            <svg style="width:24px;height:24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          </div>
          <div class="kpi-info">
            <span class="kpi-label">Clientes Cerrados</span>
            <span class="kpi-value">${wonLeads}</span>
          </div>
        </div>
        
        <div class="glass-card kpi-card">
          <div class="kpi-icon orange">
            <svg style="width:24px;height:24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
            </svg>
          </div>
          <div class="kpi-info">
            <span class="kpi-label">Conversión</span>
            <span class="kpi-value">${conversionRate}%</span>
          </div>
        </div>
      </div>

      <!-- Charts Section -->
      <div class="grid-cols-2" style="margin-bottom: 32px;">
        <div class="glass-card">
          <div class="glass-card-header">
            <div>
              <h4 class="card-title">Embudo de Ventas</h4>
              <span class="card-subtitle">Distribución de prospectos por fase de venta</span>
            </div>
          </div>
          <div class="chart-wrapper">
            <canvas id="funnelChart"></canvas>
          </div>
        </div>
        
        <div class="glass-card">
          <div class="glass-card-header">
            <div>
              <h4 class="card-title">Tasa de Respuesta</h4>
              <span class="card-subtitle">Análisis cualitativo del estado de contactos</span>
            </div>
          </div>
          <div class="chart-wrapper">
            <canvas id="responseChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Action Required & Tasks for Today list -->
      <div class="glass-card" style="padding: 24px;">
        <div class="glass-card-header" style="margin-bottom: 16px;">
          <div>
            <h4 class="card-title">Tareas de Seguimiento para Hoy</h4>
            <span class="card-subtitle">Recordatorios que debes resolver hoy para no perder el contacto</span>
          </div>
          <span class="column-badge" style="background-color: var(--accent-orange-glow); color: #fbbf24; border-color: rgba(245,158,11,0.2)">
            ${todayRemindersCount} Pendientes
          </span>
        </div>
        <div id="dashboard-today-tasks" style="display: flex; flex-direction: column; gap: 12px;">
          <!-- Loaded dynamically -->
        </div>
      </div>
    `;

    // 2. Render Today's Tasks
    renderTodayTasksList(reminders, leads);

    // 3. Render Graphs
    renderCharts(leads);

  } catch (error) {
    console.error('Error rendering dashboard:', error);
    container.innerHTML = '<div class="notifications-empty" style="color:var(--accent-red)">Error al inicializar el panel de control estadístico.</div>';
  }
}

function renderTodayTasksList(reminders, leads) {
  const container = document.getElementById('dashboard-today-tasks');
  if (!container) return;

  const todayStr = new Date().toISOString().split('T')[0];
  
  const todayReminders = reminders.filter(r => r.date === todayStr && r.status === 'pending');

  if (todayReminders.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px; border: 1px dashed var(--border-color); border-radius: var(--radius-sm)">
        🎉 ¡Estás al día! No tienes tareas programadas para hoy.
      </div>
    `;
    return;
  }

  const typeIcons = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', note: '📝' };

  container.innerHTML = todayReminders.map(rem => {
    const lead = leads.find(l => l.id === rem.leadId);
    const icon = typeIcons[rem.type] || '📝';

    return `
      <div class="glass-card" style="padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; background-color: rgba(255,255,255,0.01); border-color: rgba(255,255,255,0.05); margin: 0;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 14px; font-weight: 600;">${icon} ${rem.title}</span>
          <span style="font-size: 12px; color: var(--text-secondary);">Cliente: <strong>${lead ? lead.name : 'Desconocido'}</strong> ${lead && lead.company ? `(${lead.company})` : ''}</span>
          ${rem.description ? `<span style="font-size: 11px; color: var(--text-muted);">${rem.description}</span>` : ''}
        </div>
        <button class="btn btn-secondary" onclick="document.dispatchEvent(new CustomEvent('open-lead-detail', {detail: '${rem.leadId}'}))" style="padding: 6px 12px; font-size:12px;">
          Ver Ficha
        </button>
      </div>
    `;
  }).join('');
}

function renderCharts(leads) {
  // Destruct old instances to avoid canvas reuse warning
  if (funnelChartInstance) funnelChartInstance.destroy();
  if (responseChartInstance) responseChartInstance.destroy();

  // Group data
  const stagesCount = {
    new: 0,
    contacted: 0,
    'no-response': 0,
    interested: 0,
    meeting: 0,
    won: 0,
    lost: 0
  };

  leads.forEach(l => {
    const status = l.status || 'new';
    if (stagesCount[status] !== undefined) {
      stagesCount[status]++;
    }
  });

  // Funnel Chart (Horizontal bar)
  const funnelCtx = document.getElementById('funnelChart');
  if (funnelCtx) {
    funnelChartInstance = new Chart(funnelCtx, {
      type: 'bar',
      data: {
        labels: Object.values(STAGES).map(s => s.label),
        datasets: [{
          label: 'Prospectos',
          data: [
            stagesCount.new,
            stagesCount.contacted,
            stagesCount['no-response'],
            stagesCount.interested,
            stagesCount.meeting,
            stagesCount.won,
            stagesCount.lost
          ],
          backgroundColor: [
            'rgba(148, 163, 184, 0.6)', // new
            'rgba(59, 130, 246, 0.6)',  // contacted
            'rgba(245, 158, 11, 0.6)',  // no-response
            'rgba(124, 58, 237, 0.6)',  // interested
            'rgba(236, 72, 153, 0.6)',  // meeting
            'rgba(16, 185, 129, 0.6)',  // won
            'rgba(239, 68, 68, 0.6)'    // lost
          ],
          borderColor: [
            'rgb(148, 163, 184)',
            'rgb(59, 130, 246)',
            'rgb(245, 158, 11)',
            'rgb(124, 58, 237)',
            'rgb(236, 72, 153)',
            'rgb(16, 185, 129)',
            'rgb(239, 68, 68)'
          ],
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 15, 22, 0.95)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleFont: { family: 'Plus Jakarta Sans', weight: '600' },
            bodyFont: { family: 'Plus Jakarta Sans' }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#64748b', font: { family: 'Plus Jakarta Sans' } }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#f8fafc', font: { family: 'Plus Jakarta Sans', weight: '500' } }
          }
        }
      }
    });
  }

  // Response Rate Chart (Doughnut)
  const responseCtx = document.getElementById('responseChart');
  if (responseCtx) {
    // Group categories:
    // Positiva: Interesados, Reunión Agendada
    // Inicial: Nuevos, Contactados
    // Sin Respuesta: Sin Respuesta
    // Éxito: Won
    // Descartados: Perdidos
    const positive = stagesCount.interested + stagesCount.meeting;
    const initial = stagesCount.new + stagesCount.contacted;
    const noResponse = stagesCount['no-response'];
    const success = stagesCount.won;
    const discarded = stagesCount.lost;

    responseChartInstance = new Chart(responseCtx, {
      type: 'doughnut',
      data: {
        labels: ['Interés Alto', 'Contacto Inicial', 'Sin Respuesta', 'Clientes Ganados', 'Descartados'],
        datasets: [{
          data: [positive, initial, noResponse, success, discarded],
          backgroundColor: [
            'rgba(124, 58, 237, 0.7)',
            'rgba(59, 130, 246, 0.7)',
            'rgba(245, 158, 11, 0.7)',
            'rgba(16, 185, 129, 0.7)',
            'rgba(239, 68, 68, 0.7)'
          ],
          borderColor: 'rgba(15, 15, 22, 1)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#94a3b8',
              font: { family: 'Plus Jakarta Sans', size: 11 },
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 15, 22, 0.95)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleFont: { family: 'Plus Jakarta Sans', weight: '600' },
            bodyFont: { family: 'Plus Jakarta Sans' }
          }
        },
        cutout: '70%'
      }
    });
  }
}
