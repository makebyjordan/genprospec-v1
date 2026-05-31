export const SENDER_DEFAULTS = {
  sender: 'Jordan García',
  agency: 'Inteligencia Sevilla',
  url: 'inteligenciasevilla.com/crms.html',
  sector: 'peluquerías caninas',
  features: 'la ficha de cada perro con su historial completo (raza, tipo de corte, alergias, productos), recordatorios automáticos cuando toca la próxima cita, y el registro de preferencias de cada cliente... sin depender de la memoria ni de papeles'
};

export const SECTOR_PRESETS = {
  'peluquerías caninas': 'la ficha de cada perro con su historial completo (raza, tipo de corte, alergias, productos), recordatorios automáticos cuando toca la próxima cita, y el registro de preferencias de cada cliente... sin depender de la memoria ni de papeles',
  'talleres mecánicos': 'la ficha de cada vehículo con historial completo, avisos automáticos cuando toca la ITV o la revisión, presupuestos digitales y detección de clientes que llevan tiempo sin pasar',
  'peluquerías y estética': 'el historial de tratamientos y tintes habituales de cada cliente, la agenda integrada con recordatorios de citas automáticos por WhatsApp y el control de facturación del local',
  'clínicas y fisioterapia': 'el expediente clínico digital de cada paciente, recordatorios automáticos para evitar inasistencias a citas y facturación integrada con firmas de consentimiento digital',
  'inmobiliarias': 'la ficha detallada de inmuebles demandados y ofertados, el cruce automático de oportunidades, y el seguimiento de visitas con alertas de clientes interesados'
};

// Computes a warm, professional greeting and time/day disclaimer dynamically based on current time
export function getDynamicGreetingVars(name) {
  const now = new Date();
  const hours = now.getHours();
  const day = now.getDay(); // 0 Sunday, 6 Saturday

  let greetingBase = "Hola";
  if (hours >= 6 && hours < 13) {
    greetingBase = "Buenos días";
  } else if (hours >= 13 && hours < 20) {
    greetingBase = "Buenas tardes";
  } else {
    greetingBase = "Buenas noches";
  }

  const namePart = name ? `, ${name}` : '';
  const greeting = `${greetingBase}${namePart}`;

  const isWeekend = (day === 0 || day === 6);
  const isLate = (hours >= 20 || hours < 8);

  let disclaimer = '';
  if (isWeekend && isLate) {
    disclaimer = "Disculpa que te escriba a estas horas y en fin de semana. Esta tarde me puse a mirar";
  } else if (isWeekend) {
    disclaimer = "Disculpa que te escriba en fin de semana. Esta tarde me puse a mirar";
  } else if (isLate) {
    disclaimer = "Disculpa que te escriba a esta hora. Esta tarde me puse a mirar";
  } else {
    disclaimer = "Espero que estés teniendo un buen día y que la semana vaya genial. Esta tarde me puse a mirar";
  }

  return {
    greeting,
    disclaimer
  };
}

export const TEMPLATES = [
  {
    id: 'taller_jose',
    name: '🔧 Reseñas Específicas & Historia (Estilo José - Triana Motor)',
    description: 'Formato largo e institucional. Analiza reseñas específicas y recalca la lealtad de la clientela local.',
    fields: [
      { id: 'reviews_hook', label: 'Gancho de Reseñas leídas', placeholder: 'ej: Hay un cliente que lleva siete años contigo...', default: 'Hay un cliente que lleva siete años contigo y dice que eres el único al que le confía el coche. Otro que dice que te has ganado equipos de primera.' },
      { id: 'location', label: 'Barrio / Ciudad / Localidad', placeholder: 'ej: Triana', default: 'Triana' },
      { id: 'entity_plural', label: 'Entidad de trabajo (coche, perro, cliente)', placeholder: 'ej: coche', default: 'coche' }
    ],
    generate: (vars) => {
      const company = vars.company || 'vuestro negocio';
      
      return `${vars.greeting},
${vars.disclaimer} ${company} en Maps con calma, leyendo las reseñas una por una.
${vars.reviews_hook} Eso no es un negocio, eso es una institución en ${vars.location}.

Soy ${vars.sender}, de ${vars.agency}. Te escribo porque esa fidelidad, bien gestionada con un CRM, se multiplica: ${vars.features}. Con IA integrada el sistema anticipa cuándo va a necesitar algo cada ${vars.entity_plural} y te avisa antes de que el cliente lo piense.

Es modular, muy asequible, y la primera auditoría es completamente gratuita y sin ningún compromiso.

¿Te parece si hablamos un momento cuando tengas un hueco?

Un saludo,
${vars.sender}
${vars.agency}
Puedes ver nuestra web y lo que hacemos en: ${vars.url}`;
    }
  },
  {
    id: 'peludog_marta',
    name: '🐾 Reseñas Cariñosas & Fieles (Estilo Marta - Peludog)',
    description: 'Formato largo y cercano. Presentación local enfocada en la reputación cariñosa del sector de servicios.',
    fields: [
      { id: 'affectionate_hook', label: 'Gancho afectivo sobre reseñas', placeholder: 'ej: las reseñas son de las más completas...', default: 'las reseñas son de las más completas y cariñosas que he leído en el sector. Se nota que tienes clientes muy fieles que confían mucho en ti y en el trabajo que haces.' }
    ],
    generate: (vars) => {
      const company = vars.company || 'vuestro salón';
      
      // Adapt disclaimer slightly if it's normal hours to sound better with Peludog intro
      let timeNote = vars.disclaimer;
      if (timeNote.startsWith("Espero que estés teniendo")) {
        timeNote = "Espero que estés teniendo un buen día y que la semana vaya genial. Vi";
      } else {
        timeNote = `${timeNote.substring(0, timeNote.indexOf("Esta tarde"))}Vi`;
      }

      return `${vars.greeting},
Soy ${vars.sender}, de ${vars.agency}, empresa local de tecnología para negocios.
${timeNote} ${company} en Maps y ${vars.affectionate_hook}

Una base de clientes así merece una gestión a la altura. Por eso te escribo: desarrollamos CRMs personalizados, programas de gestión hechos completamente a medida de cómo trabaja cada profesional. Para ti podría incluir ${vars.features}. Es un sistema modular y muy asequible, pensado para crecer: podemos añadir funcionalidades con IA, automatizaciones o informes cuando los necesites.

La primera auditoría es gratuita y sin ningún compromiso. Solo sería conocernos y enseñarte lo que podríamos hacer juntos.

¿Te parece si buscamos un momento para hablar?

Un saludo,
${vars.sender}
${vars.agency}
Puedes ver nuestra web y lo que hacemos en: ${vars.url}`;
    }
  },
  {
    id: 'perfect_5_long',
    name: '⭐ Puntuación 5.0 Perfecta (Formato Largo)',
    description: 'Pone en valor la excelencia de tener una puntuación perfecta de 5.0 con muchas opiniones.',
    fields: [
      { id: 'reviews_count', label: 'Número de Reseñas', placeholder: 'ej: 172', default: '172' }
    ],
    generate: (vars) => {
      const company = vars.company || 'vuestro negocio';
      
      let timeNote = vars.disclaimer;
      if (timeNote.startsWith("Espero que estés teniendo")) {
        timeNote = "Espero que estés teniendo un buen día y que la semana vaya genial. Esta semana estuve analizando";
      } else {
        timeNote = `${timeNote.substring(0, timeNote.indexOf("Esta tarde"))}Esta semana estuve analizando`;
      }

      return `${vars.greeting},
Soy ${vars.sender}, de ${vars.agency}.
${timeNote} negocios locales destacados y me detuve a revisar ${company} en Google Maps.
Tener un 5.0 perfecto con más de ${vars.reviews_count} opiniones es una hazaña tremenda en el sector. Eso demuestra que tenéis la operativa, el cuidado y el trato muy bien trabajados.

Precisamente te escribo porque desarrollamos CRMs a medida adaptados al sector. Para un negocio excelente como el vuestro, tiene sentido que la gestión interna esté al mismo nivel: ${vars.features}. Al ser un desarrollo local y modular, es muy asequible y se ajusta a cómo trabajáis vosotros en el día a día.

La primera auditoría es gratuita y sin compromiso. Solo consiste en conocernos y enseñaros en una llamada de 20 minutos lo que podríamos construir para vuestro local.

¿Os parece si buscamos un momento para hablar cuando tengáis un hueco?

Un saludo,
${vars.sender}
${vars.agency}
Puedes ver nuestra web y lo que hacemos en: ${vars.url}`;
    }
  },
  {
    id: 'web_socials_audit',
    name: '🌐 Auditoría Digital (Sitio Web & Redes Sociales)',
    description: 'Enfocado en la optimización del canal digital. Analiza la web o redes del negocio para ofrecer una solución CRM.',
    fields: [
      { id: 'audit_note', label: 'Análisis de Web / Redes (¿Qué falta/falla?)', placeholder: 'ej: no hay botón de reserva directo, el link de WhatsApp está caído, etc.', default: 'no tenéis un botón de reservas automático en la web, lo que obliga a los clientes a escribir un correo o llamar, perdiendo reservas fuera de horario.' }
    ],
    generate: (vars) => {
      const company = vars.company || 'vuestro negocio';
      
      let presenceText = 'vuestra presencia digital';
      if (vars.website && vars.socials) {
        presenceText = `tanto vuestra web (${vars.website}) como vuestras redes (${vars.socials})`;
      } else if (vars.website) {
        presenceText = `vuestro sitio web (${vars.website})`;
      } else if (vars.socials) {
        presenceText = `vuestras redes sociales (${vars.socials})`;
      }

      return `${vars.greeting},
Soy ${vars.sender}, de ${vars.agency}.
${vars.disclaimer} ${company} en Maps y he estado analizando ${presenceText}.

Me he fijado en que ${vars.audit_note} Eso a veces hace que se pierdan clientes potenciales que quieren contactar al momento. Con un CRM a medida podéis automatizar este proceso: ${vars.features}. Además, se puede integrar un botón de reservas directo en vuestra web o perfil de Instagram que sincronice todo con vuestra agenda en tiempo real.

Es modular, muy asequible, y la primera auditoría es completamente gratuita y sin compromiso. ¿Os parecería bien que lo revisáramos juntos en una videollamada de 15 minutos?

Un saludo,
${vars.sender}
${vars.agency}
Puedes ver nuestra web en: ${vars.url}`;
    }
  }
];
