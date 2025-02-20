/**
 * ====== Constantes globales ======
 */
const SPREADSHEET_ID = '1Y4AspxB-2EX499KxunCx7tYZKc_fIdxKcn-U0S4wPcw';
const SHEETS = {
  ALERTES: 'Alertes Stock',
  EMPRUNTS: 'Emprunts',
  MODULES: 'Modules',          // Feuille dédiée aux modules
  TYPEDOBJETS: "Types d'objets"
};
const INVENTORY_SPREADSHEET_ID = '1G9JrH0unigakOpBgJ-TMm7Fg7mSDfUuY3EkqnKY105o';

/**
 * Helper pour accéder à un spreadsheet par ID.
 */
function getSpreadsheet(id = SPREADSHEET_ID) {
  return SpreadsheetApp.openById(id);
}

/**
 * Fonction utilitaire pour valider les champs obligatoires.
 */
function validateFields(formData, requiredFields) {
  const missing = requiredFields.filter(field => !formData[field]);
  if (missing.length) {
    throw new Error("Veuillez remplir les champs obligatoires: " + missing.join(", "));
  }
}

/**
 * Fonction principale d'entrée (doGet) pour servir l'application.
 */
function doGet(e) {
  e = e || {};
  e.parameter = e.parameter || {};
  
  // Gestion du cas d'impression
  if (e.parameter.print === "1" && e.parameter.moduleCode) {
    const moduleCode = e.parameter.moduleCode;
    const moduleDetails = getModuleDetailsByCode(moduleCode);
    if (!moduleDetails) {
      return HtmlService.createHtmlOutput("Module non trouvé.");
    }
    const inventoryData = getModuleInventory(moduleCode);
    const template = HtmlService.createTemplateFromFile('modules_print');
    template.moduleDetails = moduleDetails;
    template.inventoryData = inventoryData;
    return template.evaluate()
                   .setTitle("Inventaire du module : " + moduleDetails.Code + " - " + moduleDetails.Nom)
                   .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // Cas édition de l'inventaire et modification du module
  if (e.parameter.edit === "1" && e.parameter.moduleCode) {
    const moduleCode = e.parameter.moduleCode;
    const moduleDetails = getModuleDetailsByCode(moduleCode);
    if (!moduleDetails) {
      return HtmlService.createHtmlOutput("Module non trouvé.");
    }
    
    const inventoryData = getModuleInventory(moduleCode);
    const template = HtmlService.createTemplateFromFile('module_inventory_edit');
    template.moduleDetails = moduleDetails;
    template.inventoryData = inventoryData;
    
    return template.evaluate()
                   .setTitle("Modifier l'inventaire du module " + moduleDetails.Nom)
                   .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // Cas par défaut : affichage de la page index
  const baseUrl = ScriptApp.getService().getUrl();
  const template = HtmlService.createTemplateFromFile('index');
  
  // Récupération des données depuis les feuilles
  template.stockAlerts = getStockAlertsDataFromSheet();
  template.emprunts = getEmpruntsDataFromSheet();
  template.modules = getModulesDataFromSheet();
  template.materielData = getTypesObjetsDataFromSheet();
  template.empruntDetails = e.parameter.id ? getEmpruntDetailsById(e.parameter.id) : null;
  template.moduleDetails = e.parameter.moduleCode ? getModuleDetailsByCode(e.parameter.moduleCode) : null;
  
  template.baseUrl = baseUrl;
  template.activeTab = e.parameter.tab ||
                         (e.parameter.moduleCode ? 'moduleDetails' :
                          (e.parameter.id ? 'empruntDetails' : 'resume'));
  
  return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Transforme les données d'une feuille en tableau d’objets.
 */
function mapSheetData(sheet, transform) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map(row =>
    headers.reduce((obj, header, index) => {
      const value = (typeof transform === 'function')
                      ? transform(header, row[index])
                      : row[index];
      obj[header] = value;
      return obj;
    }, {})
  );
}

/**
 * Récupère les alertes de stock depuis la feuille "Alertes Stock".
 */
function getStockAlertsDataFromSheet() {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.ALERTES);
  return mapSheetData(sheet);
}

/**
 * Récupère la liste des emprunts depuis la feuille "Emprunts".
 */
function getEmpruntsDataFromSheet() {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPRUNTS);
  const timezone = Session.getScriptTimeZone();
  const transform = (header, value) => {
    if ((header === 'Date départ' || header === 'Retour prévu') && (value instanceof Date)) {
      return Utilities.formatDate(value, timezone, "dd/MM/yyyy");
    }
    return value;
  };
  return mapSheetData(sheet, transform);
}
/**
 * Construit et retourne un index des emprunts en utilisant la propriété 'Commande' comme clé.
 */
function getEmpruntsIndex() {
  const emprunts = getEmpruntsDataFromSheet();
  const index = {};
  emprunts.forEach(item => {
    index[item.Commande.toString()] = item;
  });
  return index;
}

/**
 * Retourne les détails d'un emprunt grâce à l'index.
 * Remplace la fonction existante getEmpruntDetailsById par celle-ci.
 */
function getEmpruntDetailsById(empruntId) {
  const index = getEmpruntsIndex();
  return index[empruntId.toString()] || null;
}

/**
 * Inclut le contenu d’un autre fichier HTML.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Crée un nouvel emprunt à partir des données du formulaire.
 */
function createEmprunt(formData) {
  validateFields(formData, ['nomManip', 'lieu', 'dateDepart', 'retourPrevu', 'emprunteur', 'secteur']);
  
  const newEmprunt = {
    'Commande': getNextEmpruntId(),
    'Nom manip': formData.nomManip,
    'Lieu': formData.lieu,
    'Date départ': formData.dateDepart,
    'Retour prévu': formData.retourPrevu,
    'Emprunteur': formData.emprunteur,
    'Secteur': formData.secteur,
    'Etat': formData.etat,
    'Notes': formData.notes,
    'Module': formData.module || ''
  };
  
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPRUNTS);
  const headers = sheet.getDataRange().getValues()[0];
  const newRow = headers.map(header => newEmprunt[header] || '');
  sheet.appendRow(newRow);
  
  return getEmpruntsDataFromSheet();
}

/**
 * Génère un nouvel ID unique pour un emprunt.
 */
function getNextEmpruntId() {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPRUNTS);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return 1;
  } else {
    const lastId = sheet.getRange(lastRow, 1).getValue();
    return parseInt(lastId, 10) + 1;
  }
}

/**
 * Récupère la liste des modules depuis la feuille "Modules".
 */
function getModulesDataFromSheet() {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.MODULES);
  return mapSheetData(sheet);
}
/**
 * Construit et retourne un index des modules en utilisant leur Code comme clé.
 */
function getModulesIndex() {
  const modules = getModulesDataFromSheet();
  const index = {};
  modules.forEach(module => {
    index[module.Code.toString()] = module;
  });
  return index;
}

/**
 * Retourne les détails d'un module grâce à l'index.
 * Remplace la fonction existante getModuleDetailsByCode par celle-ci.
 */
function getModuleDetailsByCode(moduleCode) {
  const index = getModulesIndex();
  return index[moduleCode.toString()] || null;
}


/**
 * Récupère les données des types d'objet depuis la feuille "Types d'objets".
 */
function getTypesObjetsDataFromSheet() {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.TYPEDOBJETS);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map((row, index) => {
    let obj = headers.reduce((acc, header, i) => {
      acc[header] = row[i];
      return acc;
    }, {});
    // Ajout du numéro de ligne (les données commencent à la ligne 2)
    obj.__row = index + 2;
    return obj;
  });
}



/**
 * Met à jour un emprunt existant dans la feuille.
 */
function updateEmprunt(formData) {
  if (!formData.commande || !formData.nomManip || !formData.lieu ||
      !formData.dateDepart || !formData.retourPrevu || !formData.emprunteur || !formData.secteur) {
    throw new Error("Veuillez remplir tous les champs obligatoires.");
  }
  
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPRUNTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  let rowToUpdate = null;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === formData.commande.toString()) {
      rowToUpdate = i + 1;
      break;
    }
  }
  
  if (!rowToUpdate) {
    throw new Error("Emprunt introuvable.");
  }
  
  const updatedRow = headers.map(header => {
    switch (header) {
      case 'Commande': return formData.commande;
      case 'Nom manip': return formData.nomManip;
      case 'Lieu': return formData.lieu;
      case 'Date départ': return formData.dateDepart;
      case 'Retour prévu': return formData.retourPrevu;
      case 'Emprunteur': return formData.emprunteur;
      case 'Secteur': return formData.secteur;
      case 'Etat': return formData.etat;
      case 'Notes': return formData.notes;
      default: return '';
    }
  });
  
  sheet.getRange(rowToUpdate, 1, 1, updatedRow.length).setValues([updatedRow]);
  return getEmpruntsDataFromSheet();
}



/**
 * Supprime l'emprunt dont la Commande correspond à `empruntId`.
 */
function deleteEmprunt(empruntId) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPRUNTS);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === empruntId.toString()) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  
  return getEmpruntsDataFromSheet();
}

/**
 * Récupère l'inventaire d'un module à partir de son code.
 */
function getModuleInventory(moduleCode) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'inventory_' + moduleCode;
  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  const moduleDetails = getModuleDetailsByCode(moduleCode);
  if (!moduleDetails) {
    throw new Error("Module non trouvé.");
  }
  
  // Utilise le Code du module pour rechercher la feuille correspondante
  const sheetName = (moduleDetails["Code"] || '').trim();
  const inventorySheet = getSpreadsheet(INVENTORY_SPREADSHEET_ID).getSheetByName(sheetName);
  if (!inventorySheet) {
    throw new Error(`Feuille "${sheetName}" introuvable dans l'inventaire.`);
  }
  
  const data = mapSheetData(inventorySheet);
  cache.put(cacheKey, JSON.stringify(data), 600);
  return data;
}

/**
 * Retourne l'ID (gid) de la feuille dont le nom correspond au Code du module.
 */
function getSheetIdByModuleCode(moduleCode) {
  const sheet = getSpreadsheet(INVENTORY_SPREADSHEET_ID).getSheetByName(moduleCode);
  if (!sheet) {
    throw new Error(`La feuille pour le code "${moduleCode}" est introuvable dans l'inventaire.`);
  }
  return sheet.getSheetId();
}

/**
 * Crée un nouveau type d'objet dans la feuille "Types d'objets".
 */
function createTypeObjet(formData) {
  if (!formData.nomObjet || !formData.categorie || !formData.dureeVie || !formData.prixRef) {
    throw new Error("Veuillez remplir tous les champs obligatoires.");
  }
  
  const sheet = getSpreadsheet().getSheetByName(SHEETS.TYPEDOBJETS);
  const headers = sheet.getDataRange().getValues()[0];
  
  const newRow = headers.map(header => {
    switch (header) {
      case "Nom de l'objet":
        return formData.nomObjet;
      case "Catégorie":
        return formData.categorie;
      case "Durée de vie":
        return formData.dureeVie;
      case "Prix de ref":
        return formData.prixRef;
      default:
        return "";
    }
  });
  
  sheet.appendRow(newRow);
  return getTypesObjetsDataFromSheet();
}

/**
 * Met à jour un type d'objet existant dans la feuille "Types d'objets".
 */
function updateTypeObjet(formData) {
  if (!formData.row || !formData.nomObjet || !formData.categorie || !formData.dureeVie || !formData.prixRef) {
    throw new Error("Veuillez remplir tous les champs.");
  }
  
  const sheet = getSpreadsheet().getSheetByName(SHEETS.TYPEDOBJETS);
  const rowToUpdate = parseInt(formData.row, 10);
  const headers = sheet.getDataRange().getValues()[0];
  
  const newRow = headers.map(header => {
    switch (header) {
      case "Nom de l'objet": return formData.nomObjet;
      case "Catégorie": return formData.categorie;
      case "Durée de vie": return formData.dureeVie;
      case "Prix de ref": return formData.prixRef;
      default: return "";
    }
  });
  
  sheet.getRange(rowToUpdate, 1, 1, newRow.length).setValues([newRow]);
  return getTypesObjetsDataFromSheet();
}

/**
 * Met à jour l'inventaire du module en ajoutant ou retirant un élément.
 */
function updateModuleInventory(formData) {
  const moduleCode = formData.moduleCode;
  const sheet = getSpreadsheet(INVENTORY_SPREADSHEET_ID).getSheetByName(moduleCode);
  if (!sheet) {
    throw new Error(`Feuille pour le module ${moduleCode} introuvable.`);
  }
  
  // Exemple : ajouter une nouvelle ligne avec la date, l'action, le nom et la quantité.
  sheet.appendRow([new Date(), formData.action, formData.nom, formData.quantite]);
  return true;
}

/**
 * Met à jour les informations du module dans la feuille "Modules".
 */
function updateModuleDetails(formData) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.MODULES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  let rowToUpdate = null;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][headers.indexOf("ID")].toString() === formData.id.toString()) {
      rowToUpdate = i + 1;
      break;
    }
  }
  
  if (!rowToUpdate) {
    throw new Error("Module non trouvé.");
  }
  
  const updatedRow = headers.map(header => {
    if (header === "ID") return formData.id;
    if (header === "Nom") return formData.Nom;
    if (header === "Code") return formData.Code;
    if (header === "Description") return formData.Description;
    return '';
  });
  
  sheet.getRange(rowToUpdate, 1, 1, updatedRow.length).setValues([updatedRow]);
  return true;
}

/**
 * Met à jour l'inventaire complet du module en remplaçant les anciennes données.
 * On suppose que la feuille d'inventaire possède une ligne d'en-tête.
 */
function updateModuleInventoryRecords(formData) {
  try {
    const moduleCode = formData.moduleCode;
    const rows = formData.rows; // Tableau d'objets avec date, action, nom et quantite

    const ss = SpreadsheetApp.openById(INVENTORY_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(moduleCode);
    if (!sheet) {
      throw new Error(`Feuille pour le module ${moduleCode} introuvable.`);
    }
    
    const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    const headers = headerRange.getValues()[0];
    
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
    
    const newData = rows.map(item => [
      item.date,
      item.action,
      item.nom,
      item.quantite
    ]);
    
    if (newData.length > 0) {
      sheet.getRange(2, 1, newData.length, newData[0].length).setValues(newData);
    }
    
    return true;
  } catch (err) {
    throw new Error("Erreur lors de la mise à jour de l'inventaire: " + err.message);
  }
}


/**
 * Met à jour un seul élément (une seule ligne) de l'inventaire.
 * formData contient :
 * - moduleCode : le code du module (nom de la feuille)
 * - row        : le numéro de ligne à mettre à jour (ex: 5)
 * - nom        : nouvelle valeur pour "Nom"
 * - quantite   : nouvelle valeur pour "Quantité"
 */
function updateSingleInventoryItem(formData) {
  const { moduleCode, row, nom, quantite } = formData;
  if (!moduleCode || !row) {
    throw new Error("Données incomplètes : moduleCode ou row manquant.");
  }
  const ss = SpreadsheetApp.openById(INVENTORY_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(moduleCode);
  if (!sheet) {
    throw new Error(`Feuille introuvable pour le code de module : ${moduleCode}`);
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  // On adapte les noms selon la feuille (par exemple "Désignation" et "Qté modules")
  const colNom = headers.indexOf("Désignation");
  const colQuantite = headers.indexOf("Qté modules");
  if (colNom === -1 || colQuantite === -1) {
    throw new Error("Impossible de trouver les colonnes 'Désignation' et/ou 'Qté modules'.");
  }
  const rowNumber = parseInt(row, 10);
  if (isNaN(rowNumber) || rowNumber < 2) {
    throw new Error(`Numéro de ligne invalide : ${rowNumber}`);
  }
  const currentData = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  currentData[colNom] = nom;
  currentData[colQuantite] = quantite;
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([currentData]);
  return mapSheetData(sheet);
}

