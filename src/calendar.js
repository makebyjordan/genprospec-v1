import { getFilteredReminders, getLeadById } from './db.js';

let currentDate = new Date();
let onEventClickCallback = null;

export function initCalendar(onEventClick) {
  onEventClickCallback = onEventClick;
}

export async function renderCalendar(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  container.className = 'calendar-wrapper glass-card';

  // Get start of month and start of week
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Create Header elements
  const headerEl = document.createElement('div');
  headerEl.className = 'calendar-ctrl-header';
  
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  headerEl.innerHTML = `
    <h3 class="calendar-month-year">${monthNames[month]} ${year}</h3>
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-secondary btn-icon-only" id="cal-btn-prev" title="Mes Anterior">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button class="btn btn-secondary" id="cal-btn-today" style="padding: 6px 12px; font-size:12px;">Hoy</button>
      <button class="btn btn-secondary btn-icon-only" id="cal-btn-next" title="Mes Siguiente">
        <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  `;
  container.appendChild(headerEl);

  // Setup header events
  headerEl.querySelector('#cal-btn-prev').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(containerId);
  });
  headerEl.querySelector('#cal-btn-next').addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(containerId);
  });
  headerEl.querySelector('#cal-btn-today').addEventListener('click', () => {
    currentDate = new Date();
    renderCalendar(containerId);
  });

  // Weekdays header row
  const weekdaysEl = document.createElement('div');
  weekdaysEl.className = 'calendar-weekdays';
  weekdaysEl.innerHTML = `
    <div>Lun</div>
    <div>Mar</div>
    <div>Mié</div>
    <div>Jue</div>
    <div>Vie</div>
    <div>Sáb</div>
    <div>Dom</div>
  `;
  container.appendChild(weekdaysEl);

  // Days grid wrapper
  const gridEl = document.createElement('div');
  gridEl.className = 'calendar-days-grid';
  container.appendChild(gridEl);

  try {
    // Load reminders
    const reminders = await getFilteredReminders();
    
    // Group reminders by date string (YYYY-MM-DD)
    const remindersMap = {};
    reminders.forEach(rem => {
      if (rem.status === 'pending') { // Only display active tasks
        const dateStr = rem.date; // YYYY-MM-DD
        if (!remindersMap[dateStr]) {
          remindersMap[dateStr] = [];
        }
        remindersMap[dateStr].push(rem);
      }
    });

    // Calculate grid numbers
    const firstDayIndex = new Date(year, month, 1).getDay(); // Sunday is 0
    // Adjust so week starts on Monday
    // Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6
    const adjustedFirstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Grid will always have 42 cells (6 rows * 7 columns)
    const totalCells = 42;
    
    let dayNum = 1;
    let nextMonthDayNum = 1;

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-day-cell';
      
      let cellDateStr = '';

      if (i < adjustedFirstDayIndex) {
        // Prev Month days
        const prevDay = prevLastDay - adjustedFirstDayIndex + i + 1;
        cell.classList.add('outside');
        cell.innerHTML = `<span class="calendar-day-number">${prevDay}</span>`;
        
        // Calculate date string
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        cellDateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(prevDay).padStart(2, '0')}`;
      } else if (dayNum <= lastDay) {
        // Current Month days
        cell.innerHTML = `<span class="calendar-day-number">${dayNum}</span>`;
        
        cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        
        if (cellDateStr === todayStr) {
          cell.classList.add('today');
        }
        dayNum++;
      } else {
        // Next Month days
        cell.classList.add('outside');
        cell.innerHTML = `<span class="calendar-day-number">${nextMonthDayNum}</span>`;
        
        // Calculate date string
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        cellDateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextMonthDayNum).padStart(2, '0')}`;
        nextMonthDayNum++;
      }

      // Add reminders list for this cell date
      const cellReminders = remindersMap[cellDateStr] || [];
      if (cellReminders.length > 0) {
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'calendar-events-container';
        
        cellReminders.forEach(rem => {
          const pill = document.createElement('div');
          
          let colorClass = 'event-note';
          if (rem.type === 'whatsapp') colorClass = 'event-whatsapp';
          else if (rem.type === 'call') colorClass = 'event-call';
          else if (rem.type === 'email') colorClass = 'event-email';
          else if (rem.type === 'meeting') colorClass = 'event-meeting';

          pill.className = `calendar-event-pill ${colorClass}`;
          
          const typeIcons = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', note: '📝' };
          pill.textContent = `${typeIcons[rem.type] || ''} ${rem.title}`;
          pill.title = `${rem.title} - ${rem.description || ''}`;

          pill.addEventListener('click', async (e) => {
            e.stopPropagation(); // Avoid cell click if any
            if (onEventClickCallback) {
              onEventClickCallback(rem.leadId);
            }
          });

          eventsContainer.appendChild(pill);
        });

        cell.appendChild(eventsContainer);
      }

      gridEl.appendChild(cell);
    }

  } catch (error) {
    console.error('Error rendering calendar events:', error);
    gridEl.innerHTML = '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--accent-red)">Error al cargar las tareas del calendario.</div>';
  }
}
