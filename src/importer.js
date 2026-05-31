import { getAllLeads } from './db.js';

// Parse raw CSV string to 2D array, handling quotes, commas, and newlines
export function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push("");
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++; // handle CRLF
      }
      lines.push(row.map(cell => cell.trim()));
      row = [""];
    } else {
      row[row.length - 1] += c;
    }
  }
  
  if (row.length > 1 || row[0] !== "") {
    lines.push(row.map(cell => cell.trim()));
  }
  
  // Filter out completely empty rows
  return lines.filter(r => r.some(cell => cell !== ""));
}

// Convert a standard Google Sheets share link into its CSV export/pub link
export function getCSVUrl(url, format = 'export') {
  if (!url) return '';

  const docIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (docIdMatch && docIdMatch[1]) {
    const spreadsheetId = docIdMatch[1];
    // Handles ?gid=, &gid=, #gid= formats
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

    if (format === 'pub' || url.includes('/pubhtml') || url.includes('/pub?')) {
      return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv${gidParam}`;
    }
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gidParam}`;
  }

  return url;
}

// Returns true if the fetched content is actually a Google login/redirect HTML page
function isHtmlResponse(text) {
  const t = (text || '').trimStart();
  return t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.startsWith('<HTML');
}

// Fetch CSV using 3-strategy cascade to overcome CORS restrictions from localhost/non-Google origins
export async function fetchCSV(url) {
  const exportUrl = getCSVUrl(url, 'export');
  const pubUrl    = getCSVUrl(url, 'pub');
  const proxyUrl  = `https://corsproxy.io/?url=${encodeURIComponent(exportUrl)}`;

  // Strategy 1 — Direct /export?format=csv
  try {
    const res = await fetch(exportUrl, { credentials: 'omit' });
    if (res.ok) {
      const text = await res.text();
      if (!isHtmlResponse(text)) { console.log('[fetchCSV] Strategy 1 OK'); return text; }
    }
  } catch (e) { console.warn('[fetchCSV] Strategy 1 failed:', e.message); }

  // Strategy 2 — /pub?output=csv (works when sheet is published to the web)
  try {
    const res = await fetch(pubUrl, { credentials: 'omit' });
    if (res.ok) {
      const text = await res.text();
      if (!isHtmlResponse(text)) { console.log('[fetchCSV] Strategy 2 OK'); return text; }
    }
  } catch (e) { console.warn('[fetchCSV] Strategy 2 failed:', e.message); }

  // Strategy 3 — CORS proxy via corsproxy.io
  try {
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const text = await res.text();
      if (!isHtmlResponse(text)) { console.log('[fetchCSV] Strategy 3 (proxy) OK'); return text; }
    }
  } catch (e) { console.warn('[fetchCSV] Strategy 3 failed:', e.message); }

  throw new Error(
    'No se pudo descargar el archivo. Asegúrate de que la hoja esté compartida como ' +
    '"Cualquier persona con el enlace puede ver". Si sigue fallando, ve a ' +
    'Archivo → Compartir → Publicar en la web → CSV y usa ese enlace.'
  );
}

// Check imported rows against DB leads to identify duplicates and new rows
export async function processImportedRows(csvRows, columnMapping) {
  if (csvRows.length < 2) return { headers: [], leads: [] };
  
  const headers = csvRows[0];
  const dataRows = csvRows.slice(1);
  const existingLeads = await getAllLeads();
  
  // Create quick lookup sets for duplicates
  const existingEmails = new Set(existingLeads.map(l => l.email ? l.email.toLowerCase().trim() : ''));
  const existingNames = new Set(existingLeads.map(l => l.name.toLowerCase().trim()));
  
  const processedLeads = dataRows.map((row, index) => {
    // Map columns dynamically based on mapping
    const getMappedValue = (field) => {
      const colIndex = columnMapping[field];
      if (colIndex !== undefined && colIndex !== -1 && colIndex < row.length) {
        return row[colIndex];
      }
      return '';
    };

    const name = getMappedValue('name');
    const email = getMappedValue('email');
    const phone = getMappedValue('phone');
    const company = getMappedValue('company');
    const website = getMappedValue('website');
    const socials = getMappedValue('socials');
    const initialNotes = getMappedValue('notes');
    const agentVal = getMappedValue('agent');
    
    let agent = 'unassigned';
    if (agentVal) {
      const lower = agentVal.toLowerCase();
      if (lower.includes('jordan')) agent = 'jordan';
      else if (lower.includes('sandra')) agent = 'sandra';
    }
    
    // Capture all columns as key-value custom fields using their headers as keys
    const customFields = {};
    headers.forEach((header, colIdx) => {
      if (colIdx < row.length && header) {
        customFields[header] = row[colIdx];
      }
    });

    // Basic verification: does it have a name?
    if (!name) return null;
    
    const emailLower = email ? email.toLowerCase().trim() : '';
    const nameLower = name.toLowerCase().trim();
    
    // Check if it already exists
    let exists = false;
    let existingId = null;
    
    if (emailLower && existingEmails.has(emailLower)) {
      exists = true;
      existingId = existingLeads.find(l => l.email && l.email.toLowerCase().trim() === emailLower)?.id;
    } else if (existingNames.has(nameLower)) {
      exists = true;
      existingId = existingLeads.find(l => l.name.toLowerCase().trim() === nameLower)?.id;
    }
    
    return {
      tempId: `temp-${index}`,
      name,
      email,
      phone,
      company,
      website,
      socials,
      initialNotes,
      agent,
      customFields,
      exists,
      existingId,
      originalRow: row
    };
  }).filter(lead => lead !== null);
  
  return {
    headers,
    leads: processedLeads
  };
}

// Default mapping heuristics based on common column names
export function autoDetectMapping(headers) {
  const mapping = {
    name: -1,
    company: -1,
    email: -1,
    phone: -1,
    website: -1,
    socials: -1,
    notes: -1
  };
  
  headers.forEach((header, index) => {
    const norm = header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    
    // Match Name
    if (mapping.name === -1 && (
      norm.includes('nombre') || 
      norm.includes('name') || 
      norm.includes('contacto') || 
      norm.includes('lead') ||
      norm.includes('cliente')
    )) {
      mapping.name = index;
    }
    
    // Match Company
    else if (mapping.company === -1 && (
      norm.includes('empresa') || 
      norm.includes('company') || 
      norm.includes('negocio') || 
      norm.includes('organizacion') ||
      norm.includes('corpora')
    )) {
      mapping.company = index;
    }
    
    // Match Email
    else if (mapping.email === -1 && (
      norm.includes('email') || 
      norm.includes('correo') || 
      norm.includes('mail') || 
      norm.includes('contacto')
    )) {
      mapping.email = index;
    }
    
    // Match Phone
    else if (mapping.phone === -1 && (
      norm.includes('telefono') || 
      norm.includes('phone') || 
      norm.includes('celular') || 
      norm.includes('movil') || 
      norm.includes('whatsapp') ||
      norm.includes('tel')
    )) {
      mapping.phone = index;
    }

    // Match Website
    else if (mapping.website === -1 && (
      norm.includes('web') || 
      norm.includes('site') || 
      norm.includes('sitio') || 
      norm.includes('url') || 
      norm.includes('pagina')
    )) {
      mapping.website = index;
    }
    
    // Match Socials
    else if (mapping.socials === -1 && (
      norm.includes('redes') || 
      norm.includes('social') || 
      norm.includes('insta') || 
      norm.includes('fb') || 
      norm.includes('link') ||
      norm.includes('twitter')
    )) {
      mapping.socials = index;
    }
    
    // Match Notes
    else if (mapping.notes === -1 && (
      norm.includes('nota') || 
      norm.includes('comentario') || 
      norm.includes('observacion') || 
      norm.includes('detalles') || 
      norm.includes('info') ||
      norm.includes('descripcion')
    )) {
      mapping.notes = index;
    }
  });
  
  // Fallbacks
  if (mapping.name === -1 && headers.length > 0) mapping.name = 0;
  if (mapping.company === -1 && headers.length > 1) mapping.company = 1;
  if (mapping.email === -1 && headers.length > 2) mapping.email = 2;
  
  return mapping;
}
