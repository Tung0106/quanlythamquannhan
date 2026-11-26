(function (global) {
    function decodeText(bytes) {
        return new TextDecoder("utf-8").decode(bytes);
    }

    function parseCsvText(text) {
        const clean = text.replace(/^\uFEFF/, "");
        const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (!lines.length) return [];

        const firstLine = lines[0];
        const commaCount = (firstLine.match(/,/g) || []).length;
        const semiCount = (firstLine.match(/;/g) || []).length;
        const tabCount = (firstLine.match(/\t/g) || []).length;
        let sep = ",";
        if (semiCount > commaCount && semiCount >= tabCount) sep = ";";
        else if (tabCount > commaCount && tabCount > semiCount) sep = "\t";

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
            throw new Error("Trình duyệt không hỗ trợ giải nén .xlsx. Vui lòng lưu Excel dưới dạng .csv (UTF-8).");
        }
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
    }

    async function unzipEntries(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const view = new DataView(arrayBuffer);

        // Locate End of Central Directory (0x06054b50)
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

    async function parseXlsxBuffer(arrayBuffer) {
        const files = await unzipEntries(arrayBuffer);
        const parser = new DOMParser();

        // Read shared strings
        const sharedStrings = [];
        if (files["xl/sharedStrings.xml"]) {
            const doc = parser.parseFromString(decodeText(files["xl/sharedStrings.xml"]), "application/xml");
            const siNodes = doc.getElementsByTagName("si");
            for (const si of siNodes) {
                const tNodes = si.getElementsByTagName("t");
                let text = "";
                for (const t of tNodes) text += t.textContent || "";
                sharedStrings.push(text.trim());
            }
        }

        // Find first worksheet
        const sheetName =
            files["xl/worksheets/sheet1.xml"]
                ? "xl/worksheets/sheet1.xml"
                : Object.keys(files)
                      .filter((k) => k.startsWith("xl/worksheets/sheet") && k.endsWith(".xml"))
                      .sort()[0];

        if (!sheetName || !files[sheetName]) {
            throw new Error("Không tìm thấy sheet dữ liệu trong file .xlsx.");
        }

        const sheetDoc = parser.parseFromString(decodeText(files[sheetName]), "application/xml");
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

    function normalizeHeader(h) {
        return String(h || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[đĐ]/g, "d")
            .toLowerCase()
            .trim();
    }

    function mapRowsToSoldiers(rows) {
        if (!rows || !rows.length) return [];

        const firstRowNorm = rows[0].map(normalizeHeader);
        let nameCol = -1;
        let unitCol = -1;
        let rankCol = -1;
        let startRow = 0;

        for (let i = 0; i < firstRowNorm.length; i++) {
            const h = firstRowNorm[i];
            if (!h) continue;
            if (h.includes("ten") || h.includes("quan nhan") || h.includes("ho va ten") || h === "name") {
                if (nameCol === -1) nameCol = i;
            } else if (h.includes("don vi") || h.includes("dai doi") || h.includes("tieu doan") || h.includes("unit")) {
                if (unitCol === -1) unitCol = i;
            } else if (h.includes("cap bac") || h.includes("chuc vu") || h.includes("rank")) {
                if (rankCol === -1) rankCol = i;
            }
        }

        if (nameCol !== -1 || unitCol !== -1 || rankCol !== -1) {
            startRow = 1;
            if (nameCol === -1) nameCol = 0;
        } else {
            // No header row: if col 0 looks like STT (digits only) and col 1 has text, use col 1 as name
            const sample = rows[0];
            if (/^\d+$/.test((sample[0] || "").trim()) && (sample[1] || "").trim()) {
                nameCol = 1;
                unitCol = sample.length > 2 ? 2 : -1;
                rankCol = sample.length > 3 ? 3 : -1;
            } else {
                nameCol = 0;
                unitCol = sample.length > 1 ? 1 : -1;
                rankCol = sample.length > 2 ? 2 : -1;
            }
        }

        const soldiers = [];
        for (let r = startRow; r < rows.length; r++) {
            const row = rows[r];
            const full_name = String(row[nameCol] || "").trim().replace(/\s+/g, " ");
            if (!full_name) continue;
            const unit_name = unitCol >= 0 ? String(row[unitCol] || "").trim().replace(/\s+/g, " ") : "";
            const rank_title = rankCol >= 0 ? String(row[rankCol] || "").trim().replace(/\s+/g, " ") : "";
            soldiers.push({ full_name, unit_name, rank_title });
        }
        return soldiers;
    }

    async function readSoldierExcelFile(file) {
        const fileName = (file.name || "").toLowerCase();
        if (fileName.endsWith(".xls")) {
            throw new Error("Định dạng .xls cũ không được hỗ trợ. Vui lòng mở bằng Excel và lưu lại dưới dạng .xlsx hoặc .csv (UTF-8).");
        }
        let rows;
        if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
            const text = await file.text();
            rows = parseCsvText(text);
        } else {
            const buf = await file.arrayBuffer();
            rows = await parseXlsxBuffer(buf);
        }
        return mapRowsToSoldiers(rows);
    }

    global.readSoldierExcelFile = readSoldierExcelFile;
})(window);
