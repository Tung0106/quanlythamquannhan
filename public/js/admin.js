(function () {
    let showFullCccd = false;
    let lastData = null;
    let csrfToken = "";
    let appToday = "";
    let isAdminRole = false;

    const filterForm = document.getElementById("filterForm");
    const filterQ = document.getElementById("filterQ");
    const filterFrom = document.getElementById("filterFrom");
    const filterTo = document.getElementById("filterTo");
    const filterStatus = document.getElementById("filterStatus");
    const toggleCccdBtn = document.getElementById("toggleCccdBtn");
    const exportCsvBtn = document.getElementById("exportCsvBtn");

    function apiFetch(url, options = {}) {
        const headers = Object.assign(
            { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
            options.headers || {}
        );
        return fetch(url, Object.assign({}, options, { headers }));
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatCccd(cccd) {
        if (!cccd) return "";
        if (showFullCccd || cccd.length < 8) return cccd;
        return cccd.slice(0, 4) + "****" + cccd.slice(-4);
    }

    function buildQueryString() {
        const params = new URLSearchParams();
        if (filterQ.value.trim()) params.set("q", filterQ.value.trim());
        if (filterFrom.value) params.set("from_date", filterFrom.value);
        if (filterTo.value) params.set("to_date", filterTo.value);
        if (filterStatus.value) params.set("status", filterStatus.value);
        return params.toString();
    }

    async function loadDashboard() {
        const qs = buildQueryString();
        exportCsvBtn.href = "/api/admin/export.csv" + (qs ? "?" + qs : "");

        try {
            const resp = await fetch("/api/admin/dashboard" + (qs ? "?" + qs : ""));
            if (resp.status === 401) {
                window.location.replace("/login");
                return;
            }
            const data = await resp.json();
            if (!data.ok) return;
            lastData = data;
            renderDashboard(data);
        } catch (err) {
            console.error("Failed to load dashboard:", err);
        }
    }

    function renderDashboard(data) {
        const s = data.summary;
        document.getElementById("kpiToday").textContent = s.today_count;
        document.getElementById("kpiActive").textContent = s.today_active;
        document.getElementById("kpiWeek").textContent = s.week_count;
        document.getElementById("kpiMonth").textContent = s.month_count;
        document.getElementById("kpiFiltered").textContent = s.filtered_total;
        document.getElementById("kpiSoldiers").textContent = s.unique_soldiers;

        document.getElementById("countVisitorsTab").textContent = data.visitors.length;
        document.getElementById("countSoldiersTab").textContent = data.by_soldier.length;

        renderVisitorsTable(data.visitors);
        renderBySoldierTable(data.by_soldier);
        renderByDateTable(data.by_date);
        renderByRelTable(data.by_relationship);
    }

    function renderVisitorsTable(visitors) {
        const tbody = document.getElementById("visitorsTbody");
        if (!visitors.length) {
            tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding: 24px; color: #6b7280;">Chưa có dữ liệu đăng ký nào trong khoảng thời gian đã chọn.</td></tr>';
            return;
        }

        tbody.innerHTML = visitors.map((v, idx) => {
            const timePart = (v.created_at || "").split(" ")[1] || "";
            const contactParts = [];
            if (v.phone) contactParts.push("SĐT: " + escapeHtml(v.phone));
            if (v.note) contactParts.push(escapeHtml(v.note));
            const contactHtml = contactParts.join("<br>") || '<span style="color:#9ca3af;">—</span>';

            const locText = v.visit_location ? escapeHtml(v.visit_location) : '<span style="color:#9ca3af;">—</span>';
            const cntNum = parseInt(v.visitor_count || 1, 10) || 1;
            const locCountHtml = `<div>${locText}</div><div class="hint" style="margin:0;"><strong>${cntNum} người</strong></div>`;

            const unitSub = v.unit_name
                ? `<div class="hint" style="margin:0;">Đơn vị: ${escapeHtml(v.unit_name)}</div>`
                : "";

            const checkedBySub = v.checked_by
                ? `<div class="hint" style="margin:2px 0 0;">${escapeHtml(v.checked_by)}</div>`
                : "";

            let actionBtns = "";
            if (v.status === "pending") {
                actionBtns += `<button class="btn btn-primary btn-sm" onclick="window.updateVisitorStatus(${v.id}, 'checked_in')">Duyệt vào</button> `;
            } else if (v.status === "checked_in") {
                actionBtns += `<button class="btn btn-outline btn-sm" onclick="window.updateVisitorStatus(${v.id}, 'checked_out')">Đã ra về</button> `;
            }
            actionBtns += `<button class="btn btn-danger btn-sm" onclick="window.deleteVisitor(${v.id}, '${escapeHtml(v.full_name)}')" title="Xóa">Xóa</button>`;

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(v.reg_code)}</strong></td>
                    <td>
                        <div>${escapeHtml(v.visit_date_vn)}</div>
                        <div class="hint" style="margin:0;">${escapeHtml(timePart)}</div>
                    </td>
                    <td><strong>${escapeHtml(v.full_name)}</strong></td>
                    <td>${escapeHtml(v.dob_vn)}</td>
                    <td style="font-family: monospace; font-size: 0.92rem;">${escapeHtml(formatCccd(v.cccd))}</td>
                    <td>${escapeHtml(v.relationship)}</td>
                    <td>
                        <strong>${escapeHtml(v.soldier_name)}</strong>
                        ${unitSub}
                    </td>
                    <td>${locCountHtml}</td>
                    <td>${contactHtml}</td>
                    <td>
                        <span class="badge badge-${escapeHtml(v.status)}">${escapeHtml(v.status_label)}</span>
                        ${checkedBySub}
                    </td>
                    <td class="no-print" style="white-space: nowrap;">${actionBtns}</td>
                </tr>
            `;
        }).join("");
    }

    function renderBySoldierTable(rows) {
        const tbody = document.getElementById("bySoldierTbody");
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 20px; color: #6b7280;">Chưa có dữ liệu tổng hợp.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((r, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td><strong>${escapeHtml(r.soldier_name)}</strong></td>
                <td>${escapeHtml(r.unit_name || "—")}</td>
                <td><strong style="color: var(--army-800); font-size: 1.05rem;">${r.total_visitors}</strong></td>
                <td>${r.pending_count}</td>
                <td>${r.checked_in_count}</td>
                <td>${r.checked_out_count}</td>
                <td>${escapeHtml(r.latest_visit_vn)}</td>
            </tr>
        `).join("");
    }

    function renderByDateTable(rows) {
        const tbody = document.getElementById("byDateTbody");
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #6b7280;">Không có dữ liệu.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((r) => `
            <tr>
                <td><strong>${escapeHtml(r.visit_date_vn)}</strong></td>
                <td><strong>${r.total_visitors}</strong></td>
                <td>${r.pending_count}</td>
                <td>${r.checked_in_count}</td>
                <td>${r.checked_out_count}</td>
            </tr>
        `).join("");
    }

    function renderByRelTable(rows) {
        const tbody = document.getElementById("byRelTbody");
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding: 20px; color: #6b7280;">Không có dữ liệu.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((r) => `
            <tr>
                <td>${escapeHtml(r.relationship)}</td>
                <td><strong>${r.total_visitors}</strong></td>
            </tr>
        `).join("");
    }

    window.updateVisitorStatus = async function (id, status) {
        const resp = await apiFetch(`/api/admin/visitors/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status }),
        });
        if (resp.ok) {
            loadDashboard();
        } else {
            const data = await resp.json();
            alert(data.error || "Không thể cập nhật trạng thái.");
        }
    };

    window.deleteVisitor = async function (id, name) {
        if (!confirm(`Xác nhận xóa hồ sơ đăng ký của "${name}"?`)) return;
        const resp = await apiFetch(`/api/admin/visitors/${id}`, { method: "DELETE" });
        if (resp.ok) {
            loadDashboard();
        } else {
            const data = await resp.json();
            alert(data.error || "Không thể xóa hồ sơ.");
        }
    };

    toggleCccdBtn.addEventListener("click", () => {
        showFullCccd = !showFullCccd;
        toggleCccdBtn.textContent = showFullCccd ? "Ẩn bớt số CCCD" : "Hiện đủ số CCCD";
        if (lastData) renderVisitorsTable(lastData.visitors);
    });

    filterForm.addEventListener("submit", (e) => {
        e.preventDefault();
        loadDashboard();
    });

    document.querySelectorAll(".quick-range").forEach((btn) => {
        btn.addEventListener("click", () => {
            const range = btn.dataset.range;
            const today = appToday;
            const d = new Date(today + "T00:00:00");

            if (range === "today") {
                filterFrom.value = today;
                filterTo.value = today;
            } else if (range === "7days") {
                const start = new Date(d);
                start.setDate(start.getDate() - 6);
                filterFrom.value = start.toISOString().slice(0, 10);
                filterTo.value = today;
            } else if (range === "month") {
                filterFrom.value = today.slice(0, 8) + "01";
                filterTo.value = today;
            } else if (range === "all") {
                filterFrom.value = "";
                filterTo.value = "";
            }
            loadDashboard();
        });
    });

    // Tabs
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(btn.dataset.tab).classList.add("active");
        });
    });

    // QR Tab
    const qrUrlInput = document.getElementById("qrUrlInput");
    const refreshQrBtn = document.getElementById("refreshQrBtn");
    const qrPreviewImg = document.getElementById("qrPreviewImg");
    const qrPreviewUrl = document.getElementById("qrPreviewUrl");
    const downloadQrBtn = document.getElementById("downloadQrBtn");
    const openPosterBtn = document.getElementById("openPosterBtn");

    function updateQrPreview() {
        const url = qrUrlInput.value.trim();
        const enc = encodeURIComponent(url);
        qrPreviewImg.src = `/api/qr.svg?url=${enc}&t=${Date.now()}`;
        qrPreviewUrl.textContent = url;
        downloadQrBtn.href = `/api/qr.svg?url=${enc}&download=1`;
        openPosterBtn.href = `/qr-poster?url=${enc}`;
    }

    refreshQrBtn.addEventListener("click", updateQrPreview);

    // Manual Visitor Modal
    const manualModal = document.getElementById("manualModal");
    const manualForm = document.getElementById("manualForm");
    const manualError = document.getElementById("manualError");
    const manualCccd = document.getElementById("manualCccd");
    const manualPhone = document.getElementById("manualPhone");
    const manualRel = document.getElementById("manualRel");
    const manualRelOtherGroup = document.getElementById("manualRelOtherGroup");
    const manualRelOther = document.getElementById("manualRelOther");

    manualCccd.addEventListener("input", () => {
        manualCccd.value = manualCccd.value.replace(/\D/g, "").slice(0, 12);
    });
    manualPhone.addEventListener("input", () => {
        manualPhone.value = manualPhone.value.replace(/\D/g, "").slice(0, 10);
    });
    manualRel.addEventListener("change", () => {
        if (manualRel.value === "Khác") {
            manualRelOtherGroup.style.display = "block";
            manualRelOther.required = true;
        } else {
            manualRelOtherGroup.style.display = "none";
            manualRelOther.required = false;
            manualRelOther.value = "";
        }
    });

    document.getElementById("openManualBtn").addEventListener("click", () => {
        manualError.style.display = "none";
        manualModal.classList.add("open");
    });

    document.getElementById("closeManualBtn").addEventListener("click", () => {
        manualModal.classList.remove("open");
    });

    manualModal.addEventListener("click", (e) => {
        if (e.target === manualModal) manualModal.classList.remove("open");
    });

    manualForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        manualError.style.display = "none";
        const formData = new FormData(manualForm);
        const payload = Object.fromEntries(formData.entries());

        if (/^(\d)\1{11}$/.test((payload.cccd || "").trim())) {
            manualError.textContent = "Số CCCD không hợp lệ (12 chữ số không được giống nhau toàn bộ).";
            manualError.style.display = "block";
            return;
        }

        const resp = await apiFetch("/api/admin/visitors", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            manualError.textContent = data.error || "Không thể lưu thông tin.";
            manualError.style.display = "block";
            return;
        }
        manualForm.reset();
        manualRelOtherGroup.style.display = "none";
        manualModal.classList.remove("open");
        loadDashboard();
    });

    // Settings Form
    const settingsForm = document.getElementById("settingsForm");
    const settingsMsg = document.getElementById("settingsMsg");

    function showBanner(el, ok, msg) {
        el.className = "alert " + (ok ? "alert-success" : "alert-error");
        el.textContent = msg;
        el.style.display = "block";
    }

    settingsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            unit_name: document.getElementById("setUnitName").value.trim(),
            gate_title: document.getElementById("setGateTitle").value.trim(),
            welcome_note: document.getElementById("setWelcomeNote").value.trim(),
            public_url: document.getElementById("setPublicUrl").value.trim(),
        };
        const resp = await apiFetch("/api/admin/settings", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        showBanner(settingsMsg, data.ok, data.ok ? "Đã lưu cấu hình đơn vị." : (data.error || "Lỗi lưu cấu hình."));
        if (data.ok && payload.public_url) {
            qrUrlInput.value = payload.public_url;
            updateQrPreview();
        }
    });

    // Profile Update Form
    const profileForm = document.getElementById("profileForm");
    const profileMsg = document.getElementById("profileMsg");
    profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const resp = await apiFetch("/api/admin/profile", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("profUsername").value.trim(),
                full_name: document.getElementById("profFullName").value.trim(),
            }),
        });
        const data = await resp.json();
        showBanner(
            profileMsg,
            data.ok,
            data.ok ? "Đã cập nhật thông tin tài khoản!" : (data.error || "Không thể cập nhật thông tin.")
        );
        if (data.ok) {
            document.getElementById("hdrUserFullName").textContent = data.full_name;
            loadUsers();
        }
    });

    // Change Password Form
    const changePwForm = document.getElementById("changePwForm");
    const pwMsg = document.getElementById("pwMsg");
    changePwForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const resp = await apiFetch("/api/admin/change-password", {
            method: "POST",
            body: JSON.stringify({
                current_password: document.getElementById("currentPw").value,
                new_password: document.getElementById("newPw").value,
            }),
        });
        const data = await resp.json();
        showBanner(pwMsg, data.ok, data.ok ? "Đổi mật khẩu thành công!" : (data.error || "Không thể đổi mật khẩu."));
        if (data.ok) {
            changePwForm.reset();
            document.getElementById("defaultPassBanner").style.display = "none";
        }
    });

    // Admin User Management
    let usersCache = [];
    const editUserModal = document.getElementById("editUserModal");
    const editUserForm = document.getElementById("editUserForm");
    const editUserError = document.getElementById("editUserError");

    document.getElementById("closeEditUserBtn").addEventListener("click", () => {
        editUserModal.classList.remove("open");
    });
    editUserModal.addEventListener("click", (e) => {
        if (e.target === editUserModal) editUserModal.classList.remove("open");
    });
    editUserForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        editUserError.style.display = "none";
        const id = document.getElementById("editUserId").value;
        const resp = await apiFetch(`/api/admin/users/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
                full_name: document.getElementById("editUserFullName").value.trim(),
                role: document.getElementById("editUserRole").value,
                new_password: document.getElementById("editUserNewPw").value,
            }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
            editUserError.textContent = data.error || "Không thể lưu thay đổi.";
            editUserError.style.display = "block";
            return;
        }
        editUserModal.classList.remove("open");
        loadUsers();
    });

    window.openEditUserModal = function (id) {
        const u = usersCache.find((item) => item.id === id);
        if (!u) return;
        editUserError.style.display = "none";
        document.getElementById("editUserId").value = u.id;
        document.getElementById("editUserTitle").textContent = u.username;
        document.getElementById("editUserFullName").value = u.full_name;
        document.getElementById("editUserRole").value = u.role;
        document.getElementById("editUserNewPw").value = "";
        editUserModal.classList.add("open");
    };

    async function loadUsers() {
        if (!isAdminRole) return;
        const tbody = document.getElementById("usersTbody");
        const resp = await fetch("/api/admin/users");
        const data = await resp.json();
        if (!data.ok) return;
        usersCache = data.users;

        tbody.innerHTML = data.users.map((u) => `
            <tr>
                <td><strong>${escapeHtml(u.username)}</strong></td>
                <td>${escapeHtml(u.full_name)}</td>
                <td>${u.role === "admin" ? "Quản trị viên" : "Cán bộ trực ban"}</td>
                <td style="white-space: nowrap;">
                    <button class="btn btn-outline btn-sm" onclick="window.openEditUserModal(${u.id})">Sửa</button>
                    <button class="btn btn-danger btn-sm" onclick="window.deleteUserAccount(${u.id}, '${escapeHtml(u.username)}')">Xóa</button>
                </td>
            </tr>
        `).join("");
    }

    window.deleteUserAccount = async function (id, username) {
        if (!confirm(`Xóa tài khoản "${username}"?`)) return;
        const resp = await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
        const data = await resp.json();
        if (data.ok) {
            loadUsers();
        } else {
            alert(data.error || "Không thể xóa tài khoản.");
        }
    };

    document.getElementById("createUserForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const userMsg = document.getElementById("userMsg");
        const resp = await apiFetch("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("newUsername").value.trim(),
                full_name: document.getElementById("newUserFullName").value.trim(),
                password: document.getElementById("newUserPassword").value,
                role: document.getElementById("newUserRole").value,
            }),
        });
        const data = await resp.json();
        showBanner(userMsg, data.ok, data.ok ? "Đã tạo tài khoản mới." : (data.error || "Lỗi tạo tài khoản."));
        if (data.ok) {
            document.getElementById("createUserForm").reset();
            loadUsers();
        }
    });

    // Soldier Roster Management (Excel Upload, Single Add, Search, Delete)
    let pendingExcelSoldiers = [];
    const soldierExcelFile = document.getElementById("soldierExcelFile");
    const uploadRosterBtn = document.getElementById("uploadRosterBtn");
    const rosterMsg = document.getElementById("rosterMsg");
    const rosterPreviewBox = document.getElementById("rosterPreviewBox");
    const rosterPreviewInfo = document.getElementById("rosterPreviewInfo");
    const rosterPreviewTbody = document.getElementById("rosterPreviewTbody");
    const rosterSearchInput = document.getElementById("rosterSearchInput");
    let rosterSearchTimer = null;

    async function loadSoldierRoster() {
        const q = rosterSearchInput.value.trim();
        const qs = q ? "?q=" + encodeURIComponent(q) : "";
        try {
            const resp = await fetch("/api/admin/soldiers" + qs);
            const data = await resp.json();
            if (!data.ok) return;

            document.getElementById("countRosterTab").textContent = data.total;
            const tbody = document.getElementById("rosterTbody");
            if (!data.soldiers.length) {
                tbody.innerHTML =
                    '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #6b7280;">Chưa có quân nhân nào trong danh sách.</td></tr>';
                return;
            }
            tbody.innerHTML = data.soldiers
                .map(
                    (s, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(s.full_name)}</strong></td>
                    <td>${escapeHtml(s.unit_name || "—")}</td>
                    <td>${escapeHtml(s.rank_title || "—")}</td>
                    <td>
                        <button class="btn btn-danger btn-sm" onclick="window.deleteSoldierItem(${s.id}, '${escapeHtml(s.full_name)}')">Xóa</button>
                    </td>
                </tr>
            `
                )
                .join("");
        } catch (err) {
            console.error("Failed to load soldier roster:", err);
        }
    }

    window.deleteSoldierItem = async function (id, name) {
        if (!confirm(`Xóa quân nhân "${name}" khỏi danh sách?`)) return;
        const resp = await apiFetch(`/api/admin/soldiers/${id}`, { method: "DELETE" });
        if (resp.ok) {
            loadSoldierRoster();
        }
    };

    soldierExcelFile.addEventListener("change", async () => {
        rosterMsg.style.display = "none";
        pendingExcelSoldiers = [];
        uploadRosterBtn.disabled = true;
        rosterPreviewBox.style.display = "none";

        const file = soldierExcelFile.files[0];
        if (!file) return;

        try {
            const parsed = await window.readSoldierExcelFile(file);
            if (!parsed.length) {
                showBanner(rosterMsg, false, "Không đọc được dòng dữ liệu quân nhân nào trong file.");
                return;
            }
            pendingExcelSoldiers = parsed;
            uploadRosterBtn.disabled = false;
            rosterPreviewInfo.textContent = `Đã đọc được ${parsed.length} quân nhân từ file "${file.name}" (xem trước tối đa 30 dòng):`;
            rosterPreviewTbody.innerHTML = parsed
                .slice(0, 30)
                .map(
                    (s, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(s.full_name)}</td>
                    <td>${escapeHtml(s.unit_name || "—")}</td>
                    <td>${escapeHtml(s.rank_title || "—")}</td>
                </tr>
            `
                )
                .join("");
            rosterPreviewBox.style.display = "block";
        } catch (err) {
            showBanner(rosterMsg, false, err.message || "Không đọc được file Excel.");
        }
    });

    uploadRosterBtn.addEventListener("click", async () => {
        if (!pendingExcelSoldiers.length) return;
        const mode = document.getElementById("rosterImportMode").value;
        if (
            mode === "replace" &&
            !confirm(
                `Thay thế toàn bộ danh sách quân nhân cũ bằng ${pendingExcelSoldiers.length} người từ file vừa chọn?`
            )
        ) {
            return;
        }

        uploadRosterBtn.disabled = true;
        uploadRosterBtn.textContent = "ĐANG LƯU...";
        try {
            const resp = await apiFetch("/api/admin/soldiers/import", {
                method: "POST",
                body: JSON.stringify({ mode, soldiers: pendingExcelSoldiers }),
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) {
                showBanner(rosterMsg, false, data.error || "Không thể nhập danh sách.");
                uploadRosterBtn.disabled = false;
                return;
            }
            showBanner(
                rosterMsg,
                true,
                `Đã nạp thành công ${data.imported} quân nhân vào hệ thống` +
                    (data.skipped ? ` (bỏ qua ${data.skipped} dòng trống/trùng/lỗi tên).` : ".")
            );
            pendingExcelSoldiers = [];
            soldierExcelFile.value = "";
            rosterPreviewBox.style.display = "none";
            loadSoldierRoster();
        } finally {
            uploadRosterBtn.textContent = "Lưu danh sách lên hệ thống";
        }
    });

    document.getElementById("downloadSampleExcelBtn").addEventListener("click", () => {
        const bom = "\uFEFF";
        const sample =
            bom +
            [
                "DANH SÁCH QUÂN SỐ TIỂU ĐOÀN 1 - ĐẠI ĐỘI 1,,,,,,,",
                "STT,Tiểu đoàn,Đại đội,Trung đội,Tiểu đội,Họ và tên,Chức vụ,Ghi chú",
                "1,Tiểu đoàn 1,Đại đội 1,Trung đội 1,Tiểu đội 1,Hồ Công Quy,Tiểu đội trưởng,",
                "2,Tiểu đoàn 1,Đại đội 1,Trung đội 1,Tiểu đội 1,Hoàng Tuấn Hoàng,Chiến sĩ,",
                "3,Tiểu đoàn 1,Đại đội 1,Trung đội 1,Tiểu đội 1,Đoàn Đức Kiên,Chiến sĩ,",
            ].join("\r\n");
        const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "mau-danh-sach-quan-nhan.csv";
        link.click();
    });

    document.getElementById("addSingleSoldierForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const resp = await apiFetch("/api/admin/soldiers", {
            method: "POST",
            body: JSON.stringify({
                full_name: document.getElementById("singleSoldierName").value.trim(),
                unit_name: document.getElementById("singleSoldierUnit").value.trim(),
                rank_title: document.getElementById("singleSoldierRank").value.trim(),
            }),
        });
        const data = await resp.json();
        showBanner(
            rosterMsg,
            data.ok,
            data.ok ? "Đã thêm quân nhân mới." : (data.error || "Không thể thêm quân nhân.")
        );
        if (data.ok) {
            document.getElementById("addSingleSoldierForm").reset();
            loadSoldierRoster();
        }
    });

    rosterSearchInput.addEventListener("input", () => {
        if (rosterSearchTimer) clearTimeout(rosterSearchTimer);
        rosterSearchTimer = setTimeout(loadSoldierRoster, 200);
    });

    document.getElementById("clearRosterBtn").addEventListener("click", async () => {
        if (!confirm("Xác nhận xóa TOÀN BỘ danh sách quân nhân đang lưu?")) return;
        const resp = await apiFetch("/api/admin/soldiers", { method: "DELETE" });
        if (resp.ok) {
            showBanner(rosterMsg, true, "Đã xóa toàn bộ danh sách quân nhân.");
            loadSoldierRoster();
        }
    });

    document.getElementById("logoutBtn").addEventListener("click", async () => {
        await apiFetch("/api/logout", { method: "POST" });
        window.location.replace("/login");
    });

    async function bootstrap() {
        const resp = await fetch("/api/admin/me");
        if (resp.status === 401) {
            window.location.replace("/login");
            return;
        }
        const data = await resp.json();
        if (!data.ok) {
            window.location.replace("/login");
            return;
        }

        csrfToken = data.csrf_token;
        appToday = data.today;
        isAdminRole = data.user.role === "admin";

        document.getElementById("hdrUnitName").textContent = data.settings.unit_name || "";
        document.getElementById("hdrGateTitle").textContent = data.settings.gate_title || "";
        document.getElementById("hdrUserFullName").textContent = data.user.full_name;
        if (data.user.must_change_password) {
            document.getElementById("defaultPassBanner").style.display = "block";
        }

        filterFrom.value = appToday;
        filterTo.value = appToday;
        document.getElementById("manualDob").max = appToday;

        if (Array.isArray(data.relationships)) {
            manualRel.innerHTML = '<option value="">-- Chọn --</option>';
            for (const rel of data.relationships) {
                const opt = document.createElement("option");
                opt.value = rel;
                opt.textContent = rel;
                manualRel.appendChild(opt);
            }
        }

        document.getElementById("setUnitName").value = data.settings.unit_name || "";
        document.getElementById("setGateTitle").value = data.settings.gate_title || "";
        document.getElementById("setWelcomeNote").value = data.settings.welcome_note || "";
        document.getElementById("setPublicUrl").value = data.settings.public_url || "";
        document.getElementById("profUsername").value = data.user.username;
        document.getElementById("profFullName").value = data.user.full_name;

        qrUrlInput.value = data.target_url;
        updateQrPreview();

        if (isAdminRole) {
            document.getElementById("adminUserSection").style.display = "block";
            loadUsers();
        }

        document.body.style.visibility = "visible";
        await Promise.all([loadDashboard(), loadSoldierRoster()]);
        setInterval(loadDashboard, 30000);
    }

    bootstrap();
})();
