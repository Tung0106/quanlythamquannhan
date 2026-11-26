(function () {
    const form = document.getElementById("registerForm");
    const formCard = document.getElementById("formCard");
    const receiptCard = document.getElementById("receiptCard");
    const errorBox = document.getElementById("formError");
    const submitBtn = document.getElementById("submitBtn");
    const relSelect = document.getElementById("relationship");
    const relOtherGroup = document.getElementById("relationshipOtherGroup");
    const relOtherInput = document.getElementById("relationship_other");
    const cccdInput = document.getElementById("cccd");
    const phoneInput = document.getElementById("phone");
    const dobInput = document.getElementById("date_of_birth");
    const soldierIdInput = document.getElementById("soldier_id");
    const soldierNameInput = document.getElementById("soldier_name");
    const soldierDropdown = document.getElementById("soldierDropdown");
    const soldierSelectedChip = document.getElementById("soldierSelectedChip");
    const soldierHint = document.getElementById("soldierHint");
    const unitInput = document.getElementById("unit_name");
    const registerAnotherBtn = document.getElementById("registerAnotherBtn");

    let hasSoldierRoster = false;
    let searchTimer = null;

    const NAME_REGEX = /^[\p{L}]+(?:[\s'.-][\p{L}]+)*$/u;

    function isValidName(str) {
        return str.length >= 2 && str.length <= 80 && NAME_REGEX.test(str);
    }

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.style.display = "block";
        errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function hideError() {
        errorBox.style.display = "none";
        errorBox.textContent = "";
    }

    function clearSelectedSoldier() {
        soldierIdInput.value = "";
        soldierSelectedChip.style.display = "none";
        soldierSelectedChip.textContent = "";
    }

    function selectSoldier(s) {
        soldierIdInput.value = String(s.id);
        soldierNameInput.value = s.full_name;
        const metaParts = [];
        if (s.rank_title) metaParts.push(s.rank_title);
        if (s.unit_name) metaParts.push(s.unit_name);
        soldierSelectedChip.textContent =
            "✓ Đã chọn: " + s.full_name + (metaParts.length ? ` (${metaParts.join(" • ")})` : "");
        soldierSelectedChip.style.display = "inline-flex";
        if (s.unit_name) {
            unitInput.value = s.unit_name;
        }
        soldierDropdown.style.display = "none";
    }

    async function searchSoldiers(q) {
        try {
            const resp = await fetch("/api/soldiers/search?q=" + encodeURIComponent(q));
            const data = await resp.json();
            if (!data.ok) return;

            soldierDropdown.innerHTML = "";
            if (!data.soldiers.length) {
                const empty = document.createElement("div");
                empty.className = "soldier-empty";
                empty.textContent = "Không tìm thấy quân nhân khớp từ khóa. Hãy kiểm tra lại họ tên.";
                soldierDropdown.appendChild(empty);
                soldierDropdown.style.display = "block";
                return;
            }

            for (const s of data.soldiers) {
                const opt = document.createElement("div");
                opt.className = "soldier-option";
                opt.tabIndex = 0;

                const nameEl = document.createElement("div");
                nameEl.className = "soldier-option-name";
                nameEl.textContent = s.full_name;
                opt.appendChild(nameEl);

                const metaParts = [];
                if (s.rank_title) metaParts.push(s.rank_title);
                if (s.unit_name) metaParts.push(s.unit_name);
                if (metaParts.length) {
                    const metaEl = document.createElement("div");
                    metaEl.className = "soldier-option-meta";
                    metaEl.textContent = metaParts.join(" • ");
                    opt.appendChild(metaEl);
                }

                opt.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectSoldier(s);
                });
                opt.addEventListener("click", () => selectSoldier(s));
                soldierDropdown.appendChild(opt);
            }
            soldierDropdown.style.display = "block";
        } catch (err) {
            console.error("Failed to search soldiers:", err);
        }
    }

    async function loadPublicInfo() {
        try {
            const resp = await fetch("/api/public-info");
            const data = await resp.json();
            if (!data.ok) return;

            if (data.settings.unit_name) {
                document.getElementById("hdrUnitName").textContent = data.settings.unit_name;
                document.title = `Đăng ký thăm quân nhân - ${data.settings.unit_name.replace(/\s*\n+\s*/g, " - ")}`;
            }
            if (data.settings.gate_title) {
                document.getElementById("hdrGateTitle").textContent = data.settings.gate_title;
            }
            if (data.settings.welcome_note) {
                document.getElementById("welcomeNoteBox").textContent = data.settings.welcome_note;
            }
            if (data.today) {
                dobInput.max = data.today;
            }
            if (Array.isArray(data.relationships)) {
                relSelect.innerHTML = '<option value="">-- Chọn quan hệ --</option>';
                for (const rel of data.relationships) {
                    const opt = document.createElement("option");
                    opt.value = rel;
                    opt.textContent = rel;
                    relSelect.appendChild(opt);
                }
            }

            hasSoldierRoster = Boolean(data.has_soldier_roster);
            if (hasSoldierRoster) {
                soldierNameInput.placeholder = "Gõ tên quân nhân để tìm kiếm và chọn...";
                soldierHint.textContent = "Gõ tên quân nhân (ví dụ: Tuấn, Bình...) rồi bấm chọn đúng người trong danh sách hiện ra.";
            }
        } catch (err) {
            console.error("Failed to load public info:", err);
        }
    }

    soldierNameInput.addEventListener("input", () => {
        if (!hasSoldierRoster) return;
        clearSelectedSoldier();
        const q = soldierNameInput.value.trim();
        if (searchTimer) clearTimeout(searchTimer);
        if (!q) {
            soldierDropdown.style.display = "none";
            return;
        }
        searchTimer = setTimeout(() => searchSoldiers(q), 180);
    });

    soldierNameInput.addEventListener("focus", () => {
        if (!hasSoldierRoster) return;
        const q = soldierNameInput.value.trim();
        if (q && !soldierIdInput.value) {
            searchSoldiers(q);
        }
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".soldier-autocomplete")) {
            soldierDropdown.style.display = "none";
        }
    });

    cccdInput.addEventListener("input", () => {
        cccdInput.value = cccdInput.value.replace(/\D/g, "").slice(0, 12);
    });

    phoneInput.addEventListener("input", () => {
        phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    });

    relSelect.addEventListener("change", () => {
        if (relSelect.value === "Khác") {
            relOtherGroup.style.display = "block";
            relOtherInput.required = true;
        } else {
            relOtherGroup.style.display = "none";
            relOtherInput.required = false;
            relOtherInput.value = "";
        }
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        const payload = {
            full_name: form.full_name.value.trim().replace(/\s+/g, " "),
            date_of_birth: form.date_of_birth.value,
            cccd: form.cccd.value.trim(),
            relationship: form.relationship.value,
            relationship_other: form.relationship_other.value.trim().replace(/\s+/g, " "),
            soldier_id: soldierIdInput.value,
            soldier_name: form.soldier_name.value.trim().replace(/\s+/g, " "),
            unit_name: form.unit_name.value.trim().replace(/\s+/g, " "),
            phone: form.phone.value.trim(),
            visit_location: form.visit_location.value.trim().replace(/\s+/g, " "),
            visitor_count: form.visitor_count.value.trim(),
            note: form.note.value.trim().replace(/\s+/g, " "),
        };

        if (!isValidName(payload.full_name)) {
            return showError("Họ tên người thăm không hợp lệ (2 - 80 ký tự, chỉ dùng chữ cái và khoảng trắng, không nhập số).");
        }
        if (!payload.date_of_birth) {
            return showError("Vui lòng chọn ngày tháng năm sinh.");
        }
        if (!/^\d{12}$/.test(payload.cccd)) {
            return showError("Số CCCD phải gồm đúng 12 chữ số, không được nhập chữ.");
        }
        if (/^(\d)\1{11}$/.test(payload.cccd)) {
            return showError("Số CCCD không hợp lệ (12 chữ số không được giống nhau toàn bộ như 000000000000 hoặc 111111111111).");
        }
        if (!payload.relationship) {
            return showError("Vui lòng chọn quan hệ với quân nhân.");
        }
        if (payload.relationship === "Khác" && (!isValidName(payload.relationship_other) || payload.relationship_other.length > 50)) {
            return showError("Vui lòng ghi rõ quan hệ khác hợp lệ (chỉ nhập chữ cái, 2 - 50 ký tự).");
        }
        if (hasSoldierRoster) {
            if (!payload.soldier_id) {
                return showError("Vui lòng gõ tên và bấm chọn quân nhân từ danh sách gợi ý.");
            }
        } else if (!isValidName(payload.soldier_name)) {
            return showError("Tên quân nhân được thăm không hợp lệ (2 - 80 ký tự, chỉ dùng chữ cái và khoảng trắng, không nhập số).");
        }
        if (!/^0\d{9}$/.test(payload.phone)) {
            return showError("Số điện thoại phải gồm đúng 10 chữ số, bắt đầu bằng số 0 và không được nhập chữ.");
        }
        const countNum = parseInt(payload.visitor_count || "0", 10);
        if (!/^\d+$/.test(payload.visitor_count) || countNum < 1 || countNum > 50) {
            return showError("Số lượng người nhà vào thăm phải từ 1 đến 50 người.");
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "ĐANG GỬI THÔNG TIN...";

        try {
            const resp = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                showError(data.error || "Không thể đăng ký, vui lòng thử lại.");
                return;
            }

            const v = data.visitor;
            document.getElementById("recCode").textContent = v.reg_code;
            document.getElementById("recName").textContent = v.full_name;
            document.getElementById("recDob").textContent = v.date_of_birth_vn;
            document.getElementById("recCccd").textContent = v.cccd_masked;
            document.getElementById("recRel").textContent = v.relationship;
            document.getElementById("recSoldier").textContent = v.soldier_name;
            document.getElementById("recDate").textContent = v.visit_date_vn;
            document.getElementById("recTime").textContent = v.created_at;
            document.getElementById("recStatus").textContent = v.status_label;

            const unitRow = document.getElementById("recUnitRow");
            if (v.unit_name) {
                unitRow.style.display = "";
                document.getElementById("recUnit").textContent = v.unit_name;
            } else {
                unitRow.style.display = "none";
            }

            const locRow = document.getElementById("recLocationRow");
            if (v.visit_location) {
                locRow.style.display = "";
                document.getElementById("recLocation").textContent = v.visit_location;
            } else {
                locRow.style.display = "none";
            }
            document.getElementById("recCount").textContent = (v.visitor_count || 1) + " người";

            formCard.style.display = "none";
            receiptCard.style.display = "block";
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err) {
            showError("Lỗi kết nối mạng. Vui lòng kiểm tra Wi-Fi / 4G và thử lại.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "ĐĂNG KÝ";
        }
    });

    registerAnotherBtn.addEventListener("click", () => {
        form.reset();
        clearSelectedSoldier();
        relOtherGroup.style.display = "none";
        hideError();
        receiptCard.style.display = "none";
        formCard.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    loadPublicInfo();
})();
