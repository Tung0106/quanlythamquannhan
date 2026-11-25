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
    const registerAnotherBtn = document.getElementById("registerAnotherBtn");

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

    async function loadPublicInfo() {
        try {
            const resp = await fetch("/api/public-info");
            const data = await resp.json();
            if (!data.ok) return;

            if (data.settings.unit_name) {
                document.getElementById("hdrUnitName").textContent = data.settings.unit_name;
                document.title = `Đăng ký thăm quân nhân - ${data.settings.unit_name}`;
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
        } catch (err) {
            console.error("Failed to load public info:", err);
        }
    }

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
            soldier_name: form.soldier_name.value.trim().replace(/\s+/g, " "),
            unit_name: form.unit_name.value.trim().replace(/\s+/g, " "),
            phone: form.phone.value.trim(),
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
        if (!payload.relationship) {
            return showError("Vui lòng chọn quan hệ với quân nhân.");
        }
        if (payload.relationship === "Khác" && (!isValidName(payload.relationship_other) || payload.relationship_other.length > 50)) {
            return showError("Vui lòng ghi rõ quan hệ khác hợp lệ (chỉ nhập chữ cái, 2 - 50 ký tự).");
        }
        if (!isValidName(payload.soldier_name)) {
            return showError("Tên quân nhân được thăm không hợp lệ (2 - 80 ký tự, chỉ dùng chữ cái và khoảng trắng, không nhập số).");
        }
        if (!/^0\d{9}$/.test(payload.phone)) {
            return showError("Số điện thoại phải gồm đúng 10 chữ số, bắt đầu bằng số 0 và không được nhập chữ.");
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
        relOtherGroup.style.display = "none";
        hideError();
        receiptCard.style.display = "none";
        formCard.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    loadPublicInfo();
})();
