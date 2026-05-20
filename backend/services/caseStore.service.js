import fs from 'fs';
import path from 'path';
import { buildCaseIdFromFingerprint } from './caseFingerprint.service.js';

const CASES_FILE = path.resolve('data/cases.json');
const CASES_FILE_BASENAME = path.basename(CASES_FILE);

function ensureDirExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizeCases(data) {
    return Array.isArray(data) ? data : [];
}

function sanitizeJsonText(raw) {
    if (typeof raw !== 'string') {
        return '';
    }

    return raw.replace(/^\uFEFF/, '').trim();
}

function writeCasesAtomically(cases) {
    ensureDirExists(CASES_FILE);

    const tempFilePath = path.join(
        path.dirname(CASES_FILE),
        `${CASES_FILE_BASENAME}.tmp`
    );

    fs.writeFileSync(tempFilePath, JSON.stringify(normalizeCases(cases), null, 2), 'utf8');
    fs.renameSync(tempFilePath, CASES_FILE);
}

function backupInvalidCasesFile(raw) {
    const backupFilePath = path.join(
        path.dirname(CASES_FILE),
        `${CASES_FILE_BASENAME}.invalid-${Date.now()}`
    );

    fs.writeFileSync(backupFilePath, raw, 'utf8');
    return backupFilePath;
}

export function getCasesFilePath() {
    return CASES_FILE;
}

export function loadCases() {
    try {
        if (!fs.existsSync(CASES_FILE)) {
            return [];
        }

        const raw = fs.readFileSync(CASES_FILE, 'utf8');
        const sanitized = sanitizeJsonText(raw);

        if (!sanitized) {
            writeCasesAtomically([]);
            return [];
        }

        return normalizeCases(JSON.parse(sanitized));
    } catch (err) {
        console.error('[CaseStore] Error loading cases:', err);
        try {
            if (fs.existsSync(CASES_FILE)) {
                const raw = fs.readFileSync(CASES_FILE, 'utf8');
                const backupFilePath = backupInvalidCasesFile(raw);
                console.error(`[CaseStore] Backed up invalid cases file to: ${backupFilePath}`);
                writeCasesAtomically([]);
            }
        } catch (recoveryError) {
            console.error('[CaseStore] Error recovering invalid cases file:', recoveryError);
        }
        return [];
    }
}

export function saveCases(cases) {
    try {
        writeCasesAtomically(cases);
        return true;
    } catch (err) {
        console.error('[CaseStore] Error saving cases:', err);
        return false;
    }
}

export function appendCase(caseRecord) {
    const cases = loadCases();
    cases.push(caseRecord);
    return saveCases(cases);
}

export function updateCase(caseId, patch) {
    const cases = loadCases();
    const index = cases.findIndex((caseRecord) => caseRecord.case_id === caseId);

    if (index === -1) {
        return null;
    }

    cases[index] = {
        ...cases[index],
        ...patch,
    };

    if (!saveCases(cases)) {
        return null;
    }

    return cases[index];
}

export function findCaseById(caseId) {
    const cases = loadCases();
    return cases.find((caseRecord) => caseRecord.case_id === caseId) || null;
}

export function findCaseByFingerprint(fingerprintOrCaseId) {
    const cases = loadCases();

    if (typeof fingerprintOrCaseId === 'string') {
        return cases.find((caseRecord) => caseRecord.case_id === fingerprintOrCaseId) || null;
    }

    if (!fingerprintOrCaseId || typeof fingerprintOrCaseId !== 'object') {
        return null;
    }

    const caseId = buildCaseIdFromFingerprint(fingerprintOrCaseId);
    return cases.find((caseRecord) => caseRecord.case_id === caseId) || null;
}
