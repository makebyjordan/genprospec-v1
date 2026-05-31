import { getFilteredReminders, getLeadById, updateReminder, addLog } from '../db.js';

let onNotificationClickCallback = null;

export function initNotifications(onNotificationClick) {
  onNotificationClickCallback = onNotificationClick;
  setupNotificationsDOM();
}

function setupNotificationsDOM() {
  const trigger = document.getElementById('notification-bell-trigger');
  const panel = document.getElementById('notifications-panel');
  
  if (!trigger || !panel) return;

  // Toggle notifications panel
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('active');
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !trigger.contains(e.target)) {
      panel.classList.remove('active');
    }
  });

  // Keep panel open when clicking inside
  panel.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

export async function refreshNotifications() {
  const badge = document.getElementById('notification-badge');
  const listEl = document.getElementById('notifications-list');
  const panel = document.getElementById('notifications-panel');
  
  if (!listEl) return;

  try {
    const reminders = await getFilteredReminders();
    const pending = reminders.filter(r => r.status === 'pending');
    
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTime = new Date(todayStr + 'T00:00:00').getTime();

    const overdue = [];
    const today = [];
    const future = [];

    for (const rem of pending) {
      const remTime = new Date(rem.date + 'T00:00:00').getTime();
      
      // Fetch lead info for this reminder
      const lead = await getLeadById(rem.leadId);
      if (!lead) continue;
      
      const enrichedReminder = {
        ...rem,
        leadName: lead.name,
        leadCompany: lead.company
      };

      if (remTime < todayTime) {
        overdue.push(enrichedReminder);
      } else if (remTime === todayTime) {
        today.push(enrichedReminder);
      } else {
        // Only show future tasks within the next 3 days to keep list clean
        const threeDaysLater = todayTime + 3 * 24 * 60 * 60 * 1000;
        if (remTime <= threeDaysLater) {
          future.push(enrichedReminder);
        }
      }
    }

    // Set badge count (Overdue + Today count)
    const alertCount = overdue.length + today.length;
    if (badge) {
      if (alertCount > 0) {
        badge.textContent = alertCount;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    }

    // Render lists inside dropdown
    if (alertCount === 0 && future.length === 0) {
      listEl.innerHTML = '<div class="notifications-empty">No hay tareas pendientes en tu agenda. ¡Buen trabajo!</div>';
      return;
    }

    let html = '';

    // Render Overdue section
    if (overdue.length > 0) {
      html += `<div style="background-color:rgba(239, 68, 68, 0.05); padding: 6px 16px; font-size:11px; font-weight:700; color:var(--accent-red); border-bottom:1px solid var(--border-color)">ATRASADAS</div>`;
      overdue.forEach(rem => {
        html += renderNotificationItem(rem, 'urgent');
      });
    }

    // Render Today section
    if (today.length > 0) {
      html += `<div style="background-color:rgba(245, 158, 11, 0.05); padding: 6px 16px; font-size:11px; font-weight:700; color:var(--accent-orange); border-bottom:1px solid var(--border-color); border-top: 1px solid var(--border-color)">HOY</div>`;
      today.forEach(rem => {
        html += renderNotificationItem(rem, 'today');
      });
    }

    // Render Future section
    if (future.length > 0) {
      html += `<div style="background-color:rgba(59, 130, 246, 0.05); padding: 6px 16px; font-size:11px; font-weight:700; color:var(--accent-blue); border-bottom:1px solid var(--border-color); border-top: 1px solid var(--border-color)">PRÓXIMAS (3 DÍAS)</div>`;
      future.forEach(rem => {
        html += renderNotificationItem(rem, 'future');
      });
    }

    listEl.innerHTML = html;

    // Attach click events to notification items
    listEl.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // If clicking complete button, handle it elsewhere
        if (e.target.closest('.btn-complete-notif')) return;
        
        const leadId = item.dataset.leadid;
        
        // Close notification panel
        if (panel) panel.classList.remove('active');
        
        if (onNotificationClickCallback) {
          onNotificationClickCallback(leadId);
        }
      });
    });

    // Attach click events to Complete buttons
    listEl.querySelectorAll('.btn-complete-notif').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const rem = reminders.find(r => r.id === id);
        
        if (rem) {
          rem.status = 'completed';
          await updateReminder(rem);
          await addLog(rem.leadId, 'system', `Completada acción desde notificaciones: "${rem.title}"`);
          
          // Refresh lists
          await refreshNotifications();
          
          // Dispatch a custom event to notify parent (main.js) that database has updated
          // so it can refresh the current active view (e.g. Calendar or Board)
          document.dispatchEvent(new CustomEvent('database-updated'));
        }
      });
    });

  } catch (error) {
    console.error('Error refreshing notifications:', error);
    listEl.innerHTML = '<div class="notifications-empty" style="color:var(--accent-red)">Error al cargar recordatorios.</div>';
  }
}

function renderNotificationItem(rem, statusType) {
  const typeIcons = { call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', note: '📝' };
  const icon = typeIcons[rem.type] || '📝';

  const dateObj = new Date(rem.date + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });

  return `
    <div class="notification-item ${statusType}" data-leadid="${rem.leadId}">
      <div class="notification-icon-wrap">
        <span style="font-size: 16px;">${icon}</span>
      </div>
      <div class="notification-info" style="flex-grow: 1; min-width: 0;">
        <span class="notification-headline" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${rem.title}</span>
        <span class="notification-desc">${rem.leadName} ${rem.leadCompany ? `(${rem.leadCompany})` : ''}</span>
        <span class="notification-meta">${rem.description ? `${rem.description} • ` : ''}${formattedDate}</span>
      </div>
      <button class="btn-complete-notif btn btn-secondary btn-icon-only" data-id="${rem.id}" title="Marcar como Completada" style="width:28px; height:28px; border-radius: 50%; font-size: 10px; align-self: center; flex-shrink: 0; background-color: rgba(255,255,255,0.03);">
        ✓
      </button>
    </div>
  `;
}
