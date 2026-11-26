(function (global) {
    function decodeText(bytes) {
        return new TextDecoder("utf-8").decode(bytes);
    }

    function parseCsvText(text) {
        const clean = text.replace(/^\uFEFF/, "");
        const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (!lines.length) return [];

        // Detect delimiter across first few non-empty lines
        const sampleText = lines.slice(0, 6).join("\n");
        const commaCount = (sampleText.match(/,/g) || []).length;
        const semiCount = (sampleText.match(/;/g) || []).length;
        const tabCount = (sampleText.match(/\t/g) || []).length;
        let sep = ",";
        if (tabCount >= semiCount && tabCount >= commaCount && tabCount > 0) sep = "\t";
        else if (semiCount > commaCount) sep = ";";

        const rows = [];
        for (const line of lines) {
            const cells = [];
            let cur = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else if (ch === '"') {
                        inQuotes = false;
                    } else {
                        cur += ch;
                    }
                } else {
                    if (ch === '"') {
                        inQuotes = true;
                    } else if (ch === sep) {
                        cells.push(cur.trim());
                        cur = "";
                    } else {
                        cur += ch;
                    }
                }
            }
            cells.push(cur.trim());
            rows.push(cells);
        }
        return rows;
    }

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream === "undefined") {
            throw new Error(
                "Trình duyệt không hỗ trợ giải nén .xlsx. Vui lòng lưu Excel dưới dạng .csv (UTF-8)."
            );
        }
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
    }

    async function unzipEntries(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const view = new DataView(arrayBuffer);

        let eocdOffset = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset < 0) {
            throw new Error("File .xlsx không hợp lệ (không tìm thấy cấu trúc ZIP).");
        }

        const totalEntries = view.getUint16(eocdOffset + 10, true);
        let cdOffset = view.getUint32(eocdOffset + 16, true);
        const files = {};

        for (let idx = 0; idx < totalEntries; idx++) {
            if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
            const compMethod = view.getUint16(cdOffset + 10, true);
            const compSize = view.getUint32(cdOffset + 20, true);
            const nameLen = view.getUint16(cdOffset + 28, true);
            const extraLen = view.getUint16(cdOffset + 30, true);
            const commentLen = view.getUint16(cdOffset + 32, true);
            const localHeaderOffset = view.getUint32(cdOffset + 42, true);

            const name = decodeText(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
            cdOffset += 46 + nameLen + extraLen + commentLen;

            if (!name.endsWith(".xml")) continue;

            const lfhNameLen = view.getUint16(localHeaderOffset + 26, true);
            const lfhExtraLen = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
            const compSlice = bytes.subarray(dataStart, dataStart + compSize);

            if (compMethod === 0) {
                files[name] = compSlice;
            } else if (compMethod === 8) {
                files[name] = await inflateRaw(compSlice);
            }
        }
        return files;
    }

    function colLettersToIndex(ref) {
        const m = String(ref || "").match(/^([A-Z]+)/i);
        if (!m) return -1;
        let idx = 0;
        const letters = m[1].toUpperCase();
        for (let i = 0; i < letters.length; i++) {
            idx = idx * 26 + (letters.charCodeAt(i) - 64);
        }
        return idx - 1;
    }

    function parseSheetDoc(sheetDoc, sharedStrings) {
        const rowNodes = sheetDoc.getElementsByTagName("row");
        const rows = [];

        for (const rowNode of rowNodes) {
            const rowArr = [];
            const cellNodes = rowNode.getElementsByTagName("c");
            for (let cIdx = 0; cIdx < cellNodes.length; cIdx++) {
                const c = cellNodes[cIdx];
                const ref = c.getAttribute("r");
                const colIdx = ref ? colLettersToIndex(ref) : cIdx;
                const type = c.getAttribute("t") || "";
                let val = "";

                if (type === "s") {
                    const vNode = c.getElementsByTagName("v")[0];
                    const sIdx = parseInt(vNode ? vNode.textContent : "-1", 10);
                    val = sIdx >= 0 && sIdx < sharedStrings.length ? sharedStrings[sIdx] : "";
                } else if (type === "inlineStr") {
                    const tNodes = c.getElementsByTagName("t");
                    for (const t of tNodes) val += t.textContent || "";
                } else {
                    const vNode = c.getElementsByTagName("v")[0];
                    val = vNode ? vNode.textContent || "" : "";
                }
                if (colIdx >= 0) {
                    rowArr[colIdx] = String(val).trim();
                }
            }
            if (rowArr.some((cell) => cell && cell.trim())) {
                rows.push(rowArr.map((x) => x || ""));
            }
        }
        return rows;
    }

    async function parseXlsxSheets(arrayBuffer) {
        const files = await unzipEntries(arrayBuffer);
        const parser = new DOMParser();

        const sharedStrings = [];
        if (files["xl/sharedStrings.xml"]) {
            const doc = parser.parseFromString(
                decodeText(files["xl/sharedStrings.xml"]),
                "application/xml"
            );
            const siNodes = doc.getElementsByTagName("si");
            for (const si of siNodes) {
                const tNodes = si.getElementsByTagName("t");
                let text = "";
                for (const t of tNodes) text += t.textContent || "";
                sharedStrings.push(text.trim());
            }
        }

        const sheetPaths = Object.keys(files)
            .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
            .sort((a, b) => {
                const na = parseInt(a.match(/\d+/)[0], 10);
                const nb = parseInt(b.match(/\d+/)[0], 10);
                return na - nb;
            });

        if (!sheetPaths.length) {
            throw new Error("Không tìm thấy sheet dữ liệu trong file .xlsx.");
        }

        const allSheetsRows = [];
        for (const sp of sheetPaths) {
            const sheetDoc = parser.parseFromString(decodeText(files[sp]), "application/xml");
            const rows = parseSheetDoc(sheetDoc, sharedStrings);
            if (rows.length) allSheetsRows.push(rows);
        }
        return allSheetsRows;
    }

    function normalizeHeader(h) {
        return String(h || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[đĐ]/g, "d")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ");
    }

    function detectHeaderRow(rows) {
        const limit = Math.min(rows.length, 20);
        for (let r = 0; r < limit; r++) {
            const norms = rows[r].map(normalizeHeader);
            let nameCol = -1;
            let battalionCol = -1;
            let companyCol = -1;
            let platoonCol = -1;
            let squadCol = -1;
            let genericUnitCol = -1;
            let rankCol = -1;

            for (let c = 0; c < norms.length; c++) {
                const h = norms[c];
                if (!h) continue;

                if (
                    h === "ho va ten" ||
                    h === "ho ten" ||
                    h.includes("ho ten") ||
                    h.includes("ho va ten") ||
                    h.includes("ten quan nhan") ||
                    h === "name"
                ) {
                    if (nameCol === -1) nameCol = c;
                } else if (h === "tieu doan" || h.includes("tieu doan")) {
                    battalionCol = c;
                } else if (h === "dai doi" || h.includes("dai doi")) {
                    companyCol = c;
                } else if (h === "trung doan" || h.includes("trung doan")) {
                    // ignore regiment column if present or treat separately
                } else if (h === "trung doi" || h.includes("trung doi")) {
                    platoonCol = c;
                } else if (h === "tieu doi" || h.includes("tieu doi")) {
                    squadCol = c;
                } else if (h === "don vi" || h.includes("don vi") || h === "unit") {
                    genericUnitCol = c;
                } else if (
                    h === "chuc vu" ||
                    h === "cap bac" ||
                    h.includes("chuc vu") ||
                    h.includes("cap bac") ||
                    h === "rank"
                ) {
                    if (rankCol === -1) rankCol = c;
                }
            }

            if (nameCol !== -1) {
                const unitCols = [battalionCol, companyCol, platoonCol, squadCol].filter(
                    (idx) => idx !== -1
                );
                if (!unitCols.length && genericUnitCol !== -1) {
                    unitCols.push(genericUnitCol);
                }
                return {
                    headerRowIdx: r,
                    nameCol,
                    unitCols,
                    rankCol,
                };
            }
        }
        return null;
    }

    function mapRowsToSoldiers(rows) {
        if (!rows || !rows.length) return [];

        const detected = detectHeaderRow(rows);
        let nameCol = 0;
        let unitCols = [];
        let rankCol = -1;
        let startRow = 0;

        if (detected) {
            startRow = detected.headerRowIdx + 1;
            nameCol = detected.nameCol;
            unitCols = detected.unitCols;
            rankCol = detected.rankCol;
        } else {
            const sample = rows[0];
            if (/^\d+$/.test((sample[0] || "").trim()) && (sample[1] || "").trim()) {
                nameCol = 1;
                if (sample.length > 2) unitCols = [2];
                if (sample.length > 3) rankCol = 3;
            } else {
                nameCol = 0;
                if (sample.length > 1) unitCols = [1];
                if (sample.length > 2) rankCol = 2;
            }
        }

        const soldiers = [];
        for (let r = startRow; r < rows.length; r++) {
            const row = rows[r];
            const firstNonEmpty = row.find((cell) => String(cell || "").trim().length > 0);
            if (firstNonEmpty) {
                const firstNorm = normalizeHeader(firstNonEmpty);
                if (
                    firstNorm.startsWith("tong cong") ||
                    firstNorm.startsWith("tong quan so") ||
                    firstNorm.startsWith("bang tong hop")
                ) {
                    break;
                }
            }

            const full_name = String(row[nameCol] || "").trim().replace(/\s+/g, " ");
            if (!full_name) continue;

            // Skip accidental repeated header or summary rows
            const nameNorm = normalizeHeader(full_name);
            if (nameNorm === "ho va ten" || nameNorm === "ho ten" || nameNorm.startsWith("tong ")) {
                continue;
            }

            const unitParts = [];
            for (const uCol of unitCols) {
                const part = String(row[uCol] || "").trim().replace(/\s+/g, " ");
                if (part && !unitParts.includes(part)) {
                    unitParts.push(part);
                }
            }
            const unit_name = unitParts.join(" - ");
            const rank_title =
                rankCol >= 0 ? String(row[rankCol] || "").trim().replace(/\s+/g, " ") : "";

            soldiers.push({ full_name, unit_name, rank_title });
        }
        return soldiers;
    }

    async function readSoldierExcelFile(file) {
        const fileName = (file.name || "").toLowerCase();
        if (fileName.endsWith(".xls")) {
            throw new Error(
                "Định dạng .xls cũ không được hỗ trợ. Vui lòng mở bằng Excel và lưu lại dưới dạng .xlsx hoặc .csv (UTF-8)."
            );
        }
        if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
            const text = await file.text();
            return mapRowsToSoldiers(parseCsvText(text));
        }

        const buf = await file.arrayBuffer();
        const sheets = await parseXlsxSheets(buf);
        const allSoldiers = [];
        for (const rows of sheets) {
            allSoldiers.push(...mapRowsToSoldiers(rows));
        }
        return allSoldiers;
    }

    global.readSoldierExcelFile = readSoldierExcelFile;
})(window);
