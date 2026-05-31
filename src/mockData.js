// Mock data for initial app load & testing

export const mockLeads = [
  {
    id: 'lead-1',
    name: 'Alejandro Gómez',
    email: 'alejandro.gomez@techsolutions.com',
    phone: '+34 612 345 678',
    company: 'TechSolutions',
    website: 'https://techsolutions.com',
    socials: '@techsolutions_es',
    status: 'new',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'lead-2',
    name: 'Laura Martínez',
    email: 'laura.m@creativestudio.io',
    phone: '+34 622 987 654',
    company: 'Creative Studio',
    website: 'https://creativestudio.io',
    socials: '@creativestudio_io',
    status: 'contacted',
    createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'lead-3',
    name: 'Carlos Ruiz',
    email: 'cruiz@globallogistics.es',
    phone: '+34 633 456 123',
    company: 'Global Logistics',
    website: 'https://globallogistics.es',
    socials: '',
    status: 'no-response',
    createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'lead-4',
    name: 'Sofía Pineda',
    email: 'sofia@edutech.org',
    phone: '+34 655 789 012',
    company: 'EduTech Org',
    website: '',
    socials: '@edutech_org',
    status: 'interested',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'lead-5',
    name: 'Javier Torres',
    email: 'j.torres@finanzas-sa.com',
    phone: '+34 677 321 654',
    company: 'Finanzas S.A.',
    website: 'https://finanzas-sa.com',
    socials: '@finanzas_sa',
    status: 'meeting',
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'lead-6',
    name: 'Elena Rivas',
    email: 'elena.rivas@retailcorp.com',
    phone: '+34 688 111 222',
    company: 'Retail Corp',
    website: '',
    socials: '',
    status: 'won',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'lead-7',
    name: 'Marcos Díaz',
    email: 'mdiaz@consultingpro.com',
    phone: '+34 699 444 555',
    company: 'Consulting Pro',
    website: 'https://consultingpro.com',
    socials: '@consulting_pro',
    status: 'lost',
    createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  }
];

export const mockLogs = [
  // Laura
  { leadId: 'lead-2', type: 'whatsapp', content: 'Enviado primer mensaje presentándonos y ofreciendo demo.', timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-2', type: 'system', content: 'Lead creado e importado desde Google Sheets.', timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-2', type: 'note', content: 'Dijo que lo revisaría este fin de semana.', timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },

  // Carlos
  { leadId: 'lead-3', type: 'system', content: 'Lead importado.', timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-3', type: 'call', content: 'Llamada telefónica realizada de seguimiento. No responde, salta buzón.', timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-3', type: 'email', content: 'Enviado correo electrónico recordatorio.', timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },

  // Sofia
  { leadId: 'lead-4', type: 'system', content: 'Lead importado.', timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-4', type: 'whatsapp', content: 'Contacto por WhatsApp. Responde interesada en tarifas.', timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-4', type: 'note', content: 'Solicita cotización para 15 usuarios. Le gusta el enfoque.', timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },

  // Javier
  { leadId: 'lead-5', type: 'system', content: 'Lead importado.', timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-5', type: 'call', content: 'Llamada de cualificación de 10 min. Confirmó encaje.', timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-5', type: 'email', content: 'Enviada propuesta preliminar y link de Calendly.', timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-5', type: 'meeting', content: 'Reunión agendada para demostración completa en vivo.', timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },

  // Elena
  { leadId: 'lead-6', type: 'system', content: 'Lead importado.', timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-6', type: 'meeting', content: 'Videollamada de Demo realizada. Muy buena recepción.', timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-6', type: 'note', content: 'Enviado contrato final. Firma en proceso.', timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-6', type: 'system', content: 'Estado cambiado a Ganado: Cliente Cerrado.', timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },

  // Marcos
  { leadId: 'lead-7', type: 'system', content: 'Lead importado.', timestamp: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-7', type: 'call', content: 'Llamada de seguimiento. Comenta que acaban de contratar a un competidor local.', timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { leadId: 'lead-7', type: 'system', content: 'Estado cambiado a Perdido/Descartado.', timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() }
];

export const mockReminders = [
  {
    leadId: 'lead-4',
    title: 'Enviar presupuesto formal',
    description: 'Enviar PDF con cotización personalizada para 15 usuarios.',
    date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // tomorrow
    type: 'email',
    status: 'pending'
  },
  {
    leadId: 'lead-5',
    title: 'Videollamada de Demostración',
    description: 'Presentar pantalla y responder dudas técnicas del equipo de TI.',
    date: new Date(Date.now()).toISOString().split('T')[0], // today!
    type: 'meeting',
    status: 'pending'
  },
  {
    leadId: 'lead-2',
    title: 'Escribir por WhatsApp de seguimiento',
    description: 'Preguntar si pudo revisar el documento de la propuesta.',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // yesterday (overdue!)
    type: 'whatsapp',
    status: 'pending'
  }
];

// Raw CSV string simulating a Google Sheets export
export const mockGoogleSheetsCSV = `Nombre Completo,Empresa,Email,Telefono,Sitio Web,Redes Sociales,Comentarios Adicionales
Roberto Varela,Varela & Asociados,roberto@varela.com,+34 600 777 888,https://varela.com,@varela_asoc,Interesado en auditoría fiscal para su pyme.
Marta Ortiz,Smart Learning,marta.ortiz@smartlearning.edu,+34 611 222 333,https://smartlearning.edu,,Socio fundador. Quiere implementar plataforma en Septiembre.
Laura Martínez,Creative Studio,laura.m@creativestudio.io,+34 622 987 654,https://creativestudio.io,@creativestudio_io,Contacto duplicado (ya en seguimiento para pruebas de filtro)
Diego Cruz,Logistic Express,d.cruz@logexpress.com,+34 644 555 666,,@logistic_express,Solicitud enviada a través de formulario web de contacto.
Lucía Castillo,Design Alchemy,lucia@designalchemy.co,,,Diseñadora Freelance. Preguntó por precios mensuales.
`;
