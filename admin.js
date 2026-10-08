/* LEN admin UI. All privileged requests go through the protected same-origin worker API. */
(() => {
  "use strict";
  // ===== Supabase direct connection =====
  const SUPABASE_URL = "https://nmtdliqubfpextwdfqkf.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tdGRsaXF1YmZwZXh0d2RmcWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNzE0MjUsImV4cCI6MjEwNjc0NzQyNX0.9XrmjJ9usGauKu82L82DyL5dAt_YhfwZXq5uq55I2NY";
  const REST = `${SUPABASE_URL}/rest/v1`;
  const STORAGE_BUCKET = "product-images";
  const SB_HEADERS = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const content = $("#pageContent");
  const state = {
    view: "dashboard", busy: false, error: "", categories: [], products: [], orders: [], customers: [],
    settings: {}, summary: {}, pages: {},
    filters: { products: { q: "", category: "", active: "" }, discounts: { q: "" }, orders: { q: "", status: "" }, inventory: { q: "", stock: "" }, customers: { q: "" } }
  };
  const PAGE_TITLES = {
    dashboard: "نظرة عامة", orders: "الطلبات", products: "المنتجات", discounts: "الخصومات", categories: "الفئات",
    inventory: "المخزون", customers: "العملاء", payments: "المدفوعات", settings: "الإعدادات"
  };
  const ORDER_STATUSES = [
    ["new", "جديد"], ["waiting_for_deposit", "بانتظار العربون"], ["deposit_received", "تم استلام العربون"],
    ["confirmed", "مؤكد"], ["preparing", "قيد التجهيز"], ["shipped", "تم الشحن"],
    ["delivered", "تم التوصيل"], ["cancelled", "ملغي"]
  ];
  const PAYMENT_STATUSES = [
    ["pending", "قيد الانتظار"], ["deposit_submitted", "تم إرسال العربون"],
    ["deposit_received", "تم استلام العربون"], ["failed", "متعثر"]
  ];
  const ORDER_LABELS = Object.fromEntries(ORDER_STATUSES);
  const PAYMENT_LABELS = Object.fromEntries(PAYMENT_STATUSES);
  const money = (value, currency = state.settings.currency || "EGP") =>
    `${currency} ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const integer = value => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const attr = esc;
  const date = value => value ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const productName = product => product?.name_ar || product?.name_en || "منتج";
  const customerName = order => order?.customer?.full_name || "عميل";
  const categoryName = product => product?.category?.name_ar || product?.category?.name_en || "—";
  const discountPercent = product => {
    const value = Number(product?.discount_percentage ?? 0);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
  };
  const discountedPrice = product => Number((Number(product?.price || 0) * (1 - discountPercent(product) / 100)).toFixed(2));
  const productPriceDisplay = product => discountPercent(product)
    ? `<span class="price-stack"><s>${money(product.price)}</s><strong class="sale-price">${money(discountedPrice(product))}</strong></span>`
    : money(product.price);
  const statusClass = status => {
    if (["confirmed", "preparing", "shipped", "delivered", "deposit_received"].includes(status)) return "status-green";
    if (["new", "waiting_for_deposit", "deposit_submitted"].includes(status)) return "status-amber";
    if (["cancelled", "failed"].includes(status)) return "status-red";
    return "status-muted";
  };
  const stockStatus = product => {
    const count = Number(product.stock_quantity || 0);
    if (!count) return ["نفد المخزون", "status-red"];
    if (count <= Number(state.settings.low_stock_threshold ?? 5)) return ["مخزون منخفض", "status-amber"];
    return ["متوفر", "status-green"];
  };
  const toast = (message, type = "success") => {
    const node = document.createElement("div");
    node.className = `toast ${type === "error" ? "error" : ""}`;
    node.textContent = message;
    $("#toastRegion").append(node);
    window.setTimeout(() => node.remove(), 4200);
  };
  const setSync = (kind, text) => {
    const node = $("#syncStatus");
    node.className = `sync-status ${kind}`;
    $("span", node).textContent = text;
  };
  async function api(path, options = {}) {
    const method = options.method || "GET";
    let body = options.body;
    let url = "";
    let m;
    const byId = (table, id) => `${REST}/${table}?id=eq.${id}`;
    if ((m = path.match(/^\/(products|categories)\/([^/]+)$/))) url = byId(m[1], m[2]);
    else if ((m = path.match(/^\/(products|categories|product_images)$/))) url = `${REST}/${m[1]}`;
    else if ((m = path.match(/^\/inventory\/([^/]+)$/))) url = byId("products", m[1]);
    else if ((m = path.match(/^\/settings\/([^/]+)$/))) url = byId("store_settings", m[1]);
    else if ((m = path.match(/^\/orders\/([^/]+)\/(payment|status)$/))) url = byId("orders", m[1]);
    else if ((m = path.match(/^\/images\/([^/]+)$/))) url = byId("product_images", m[1]);
    else if ((m = path.match(/^\/images\/([^/]+)\/main$/))) {
      const image = state.products.flatMap(p => p.images || []).find(img => String(img.id) === m[1]);
      if (!image) throw new Error("لم يتم العثور على الصورة.");
      url = byId("products", image.product_id);
      body = JSON.stringify({ image_url: image.image_url });
    } else throw new Error(`مسار غير مدعوم: ${path}`);
    const headers = { ...SB_HEADERS, ...(options.headers || {}) };
    if (method === "POST" || method === "PATCH") headers.Prefer = "return=representation";
    if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(url, { method, body, headers });
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload?.message || payload?.error || `تعذر تنفيذ الطلب (${response.status})`);
    return payload;
  }
  async function sbGet(path) {
    const response = await fetch(`${REST}${path}`, { headers: SB_HEADERS });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `تعذر تحميل البيانات (${response.status})`);
    return Array.isArray(payload) ? payload : [];
  }
  function buildSummary() {
    const confirmed = ["confirmed", "preparing", "shipped", "delivered"];
    const pending = ["new", "waiting_for_deposit"];
    const threshold = Number(state.settings.low_stock_threshold ?? 5);
    return {
      total_orders: state.orders.length,
      pending_orders: state.orders.filter(o => pending.includes(o.order_status)).length,
      confirmed_orders: state.orders.filter(o => confirmed.includes(o.order_status)).length,
      total_sales: state.orders.filter(o => confirmed.includes(o.order_status)).reduce((sum, o) => sum + Number(o.subtotal || 0), 0),
      pending_deposits: state.orders.filter(o => o.payment_status === "deposit_submitted").reduce((sum, o) => sum + Number(o.deposit_amount || 0), 0),
      total_products: state.products.length,
      low_stock_products: state.products.filter(p => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= threshold).length,
      sold_out_products: state.products.filter(p => !Number(p.stock_quantity)).length
    };
  }
  async function loadData({ quiet = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    if (!quiet) content.innerHTML = '<div class="loading-state"><span class="spinner"></span><span>جارٍ تحميل بيانات المتجر…</span></div>';
    setSync("", "جارٍ الاتصال");
    try {
      const [categories, products, orders, customers, settingsRows] = await Promise.all([
        sbGet("/categories?select=*"),
        sbGet("/products?select=*,category:categories(*),images:product_images(*)&order=created_at.desc"),
        sbGet("/orders?select=*,customer:customers(*)&order=created_at.desc"),
        sbGet("/customers?select=*&order=created_at.desc"),
        sbGet("/store_settings?select=*&limit=1")
      ]);
      state.categories = categories;
      state.products = products;
      state.orders = orders;
      state.customers = customers;
      state.settings = settingsRows[0] || {};
      state.summary = buildSummary();
      setSync("connected", "متصل · بيانات مباشرة");
      $("#pendingNavCount").textContent = integer(state.summary.pending_orders || 0);
      render();
    } catch (error) {
      state.error = error.message || "تعذر تحميل البيانات.";
      setSync("error", "تعذر الاتصال");
      renderError();
    } finally {
      state.busy = false;
    }
  }
  function renderError() {
    content.innerHTML = `<div class="error-state"><span class="error-mark">!</span><strong>تعذر تحميل بيانات LEN</strong><p>${esc(state.error)}<br>تحقق من إعدادات الاتصال بقاعدة Supabase وصلاحيات الوصول، ثم أعد المحاولة.</p><button class="button" data-action="refresh">إعادة المحاولة</button></div>`;
  }
  function updateNavigation() {
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
    $("#pageTitle").textContent = PAGE_TITLES[state.view] || "إدارة LEN";
    $("#discountNavCount").textContent = integer(state.products.filter(product => discountPercent(product) > 0).length);
    $("#sidebar").classList.remove("open");
    $("#sidebarScrim").classList.remove("open");
  }
  function render() {
    updateNavigation();
    const views = {
      dashboard: renderDashboard, orders: renderOrders, products: renderProducts,
      discounts: renderDiscounts,
      categories: renderCategories, inventory: renderInventory, customers: renderCustomers,
      payments: renderPayments, settings: renderSettings
    };
    content.innerHTML = (views[state.view] || renderDashboard)();
  }
  function pageHeading(title, subtitle, action = "") {
    return `<div class="page-heading"><div><h2>${title}</h2><p>${subtitle}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ""}</div>`;
  }
  function metric(label, value, symbol, foot = "") {
    return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-symbol">${symbol}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`;
  }
  function orderStatusBadge(status) {
    return `<span class="status ${statusClass(status)}">${esc(ORDER_LABELS[status] || status || "—")}</span>`;
  }
  function paymentStatusBadge(status) {
    return `<span class="status ${statusClass(status)}">${esc(PAYMENT_LABELS[status] || status || "—")}</span>`;
  }
  function renderDashboard() {
    const s = state.summary;
    const recent = [...state.orders].slice(0, 6);
    const low = state.products.filter(product => Number(product.stock_quantity) <= Number(state.settings.low_stock_threshold ?? 5)).slice(0, 6);
    return `${pageHeading("مرحبًا بكِ في LEN", "ملخص مباشر لحركة المتجر ومخزونه.")}
      <div class="metric-grid">
        ${metric("إجمالي الطلبات", integer(s.total_orders), "▤", "كل الطلبات المسجلة")}
        ${metric("طلبات قيد المتابعة", integer(s.pending_orders), "◷", "تحتاج إلى إجراء")}
        ${metric("الطلبات المؤكدة", integer(s.confirmed_orders), "✓", "تشمل التجهيز والشحن والتوصيل")}
        ${metric("إجمالي المبيعات", money(s.total_sales), "◈", "للطلبات المؤكدة وما بعدها")}
        ${metric("عربون قيد التحصيل", money(s.pending_deposits), "↗", "المبالغ غير المستلمة")}
        ${metric("إجمالي المنتجات", integer(s.total_products), "◇", "منتجات المتجر")}
        ${metric("مخزون منخفض", integer(s.low_stock_products), "!", `الحد الأدنى ${integer(state.settings.low_stock_threshold ?? 5)} قطع`)}
        ${metric("نفد المخزون", integer(s.sold_out_products), "×", "تحتاج إلى إعادة تزويد")}
      </div>
      <div class="dashboard-grid">
        <section class="panel"><header class="panel-header"><div><h3>أحدث الطلبات</h3><p>آخر الطلبات المسجلة في المتجر</p></div><button class="panel-link" data-view="orders">عرض الكل ←</button></header>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الطلب</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
          ${recent.length ? recent.map(order => `<tr><td><span class="table-main latin">${esc(order.order_number)}</span></td><td>${esc(customerName(order))}</td><td class="price">${money(order.subtotal)}</td><td>${orderStatusBadge(order.order_status)}</td><td class="latin">${date(order.created_at)}</td></tr>`).join("") : '<tr><td colspan="5" class="table-empty">لا توجد طلبات بعد.</td></tr>'}
          </tbody></table></div>
        </section>
        <section class="panel"><header class="panel-header"><div><h3>تنبيه المخزون</h3><p>منتجات وصلت إلى حد إعادة الطلب</p></div><button class="panel-link" data-view="inventory">إدارة المخزون ←</button></header>
          <div class="panel-content"><div class="stock-list">${low.length ? low.map(product => { const [label, cls] = stockStatus(product); return `<div class="stock-row"><div><div class="stock-name">${esc(productName(product))}</div><div class="stock-count">المتبقي: ${integer(product.stock_quantity)}</div></div><span class="status ${cls}">${label}</span></div>`; }).join("") : '<div class="empty-state">المخزون بحالة جيدة.</div>'}</div></div>
        </section>
      </div>`;
  }
  function toolbar(searchPlaceholder, filter = "", action = "") {
    const value = state.filters[state.view]?.q || "";
    return `<div class="toolbar"><div class="toolbar-start"><label class="search-box"><span class="screen-reader-only">بحث</span><input type="search" data-search value="${attr(value)}" placeholder="${attr(searchPlaceholder)}"></label>${filter}</div><div class="toolbar-end">${action}</div></div>`;
  }
  function statusFilter() {
    const selected = state.filters.orders.status;
    return `<select class="filter-select" data-order-filter aria-label="تصفية الطلبات"><option value="">كل الحالات</option>${ORDER_STATUSES.map(([value,label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  }
  function categoryFilter() {
    const selected = state.filters.products.category;
    return `<select class="filter-select" data-category-filter aria-label="تصفية الفئات"><option value="">كل الفئات</option>${state.categories.map(category => `<option value="${attr(category.id)}" ${selected === category.id ? "selected" : ""}>${esc(category.name_ar || category.name_en)}</option>`).join("")}</select>`;
  }
  function pagination(key, total, perPage = 15) {
    const pages = Math.max(1, Math.ceil(total / perPage));
    state.pages[key] = Math.min(Math.max(1, state.pages[key] || 1), pages);
    const current = state.pages[key];
    return `<div class="pagination"><span>عرض ${integer(total ? (current - 1) * perPage + 1 : 0)}–${integer(Math.min(current * perPage, total))} من ${integer(total)}</span><div class="pagination-controls">${Array.from({length: pages}, (_,i) => `<button class="page-btn ${i + 1 === current ? "active" : ""}" data-page="${key}" data-number="${i + 1}">${i + 1}</button>`).join("")}</div></div>`;
  }
  function productPhoto(product) {
    const url = product.image_url || product.images?.[0]?.image_url;
    return `<span class="product-thumb">${url ? `<img src="${attr(url)}" alt="" loading="lazy" onerror="this.remove()">` : "<span>LEN</span>"}</span>`;
  }
  function renderProducts() {
    const q = (state.filters.products.q || "").trim().toLocaleLowerCase();
    const categoryId = state.filters.products.category;
    const activeTab = state.filters.products.active;
    const filtered = state.products.filter(product => {
      const text = `${product.name_ar || ""} ${product.name_en || ""}`.toLocaleLowerCase();
      return (!q || text.includes(q)) && (!categoryId || product.category_id === categoryId) &&
        (!activeTab || (activeTab === "active" ? product.is_active : !product.is_active));
    });
    const per = 15;
    const current = Math.min(state.pages.products || 1, Math.max(1, Math.ceil(filtered.length / per)));
    state.pages.products = current;
    const visible = filtered.slice((current - 1) * per, current * per);
    const action = '<button class="button" data-action="add-product">＋ إضافة منتج</button>';
    return `${pageHeading("المنتجات", "إدارة تفاصيل المنتجات والأسعار والصور والمخزون.", action)}
      ${toolbar("ابحثي باسم المنتج…", `${categoryFilter()}<select class="filter-select" data-active-filter aria-label="حالة المنتج"><option value="" ${!state.filters.products.active ? "selected" : ""}>كل المنتجات</option><option value="active" ${state.filters.products.active === "active" ? "selected" : ""}>نشط</option><option value="inactive" ${state.filters.products.active === "inactive" ? "selected" : ""}>غير نشط</option></select>`, "")}
      <section class="panel"><div class="table-wrap mobile-stack"><table class="data-table"><thead><tr><th>المنتج</th><th>الفئة</th><th>السعر</th><th>المخزون</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>
      ${visible.length ? visible.map(product => { const [stockLabel, stockClass] = stockStatus(product); return `<tr>
        <td class="product-mobile-cell"><div class="product-cell">${productPhoto(product)}<span><span class="table-main">${esc(productName(product))}</span><span class="table-sub latin">${esc(product.name_en || "")}</span></span></div></td>
        <td data-label="الفئة">${esc(categoryName(product))}</td><td data-label="السعر" class="price">${productPriceDisplay(product)}</td>
        <td data-label="المخزون"><span class="latin">${integer(product.stock_quantity)}</span> <span class="status ${stockClass}">${stockLabel}</span></td>
        <td data-label="حالة المنتج"><span class="status ${product.is_active ? "status-green" : "status-muted"}">${product.is_active ? "نشط" : "غير نشط"}</span></td>
        <td data-label="الإجراء" class="mobile-actions"><div class="table-actions"><button class="text-button" data-action="edit-product" data-id="${attr(product.id)}">تعديل</button><button class="text-button" data-action="set-product-discount" data-id="${attr(product.id)}">${discountPercent(product) ? "تعديل الخصم" : "إضافة خصم"}</button><button class="text-button" data-action="toggle-product" data-id="${attr(product.id)}">${product.is_active ? "إيقاف" : "تفعيل"}</button><button class="text-button danger" data-action="delete-product" data-id="${attr(product.id)}">حذف</button></div></td>
      </tr>`; }).join("") : `<tr><td colspan="6" class="table-empty">${state.products.length ? "لا توجد نتائج مطابقة." : "لا توجد منتجات. أضيفي أول منتج للبدء."}</td></tr>`}
      </tbody></table></div>${pagination("products", filtered.length, per)}</section>`;
  }
  function renderDiscounts() {
    const query = (state.filters.discounts.q || "").trim().toLocaleLowerCase();
    const discounted = state.products.filter(product => discountPercent(product) > 0);
    const filtered = discounted.filter(product => `${product.name_ar || ""} ${product.name_en || ""}`.toLocaleLowerCase().includes(query));
    const per = 15;
    const current = Math.min(state.pages.discounts || 1, Math.max(1, Math.ceil(filtered.length / per)));
    state.pages.discounts = current;
    const visible = filtered.slice((current - 1) * per, current * per);
    const highestDiscount = discounted.reduce((highest, product) => Math.max(highest, discountPercent(product)), 0);
    const biggestSaving = discounted.reduce((highest, product) => Math.max(highest, Number(product.price || 0) - discountedPrice(product)), 0);
    return `${pageHeading("الخصومات", "تابعي المنتجات المخفّضة وعدّلي نسبة الخصم لكل منتج من هنا أو من صفحة المنتجات.")}
      <div class="metric-grid discount-metrics">
        ${metric("منتجات عليها خصم", integer(discounted.length), "٪", "الخصومات المفعّلة حاليًا")}
        ${metric("أعلى نسبة خصم", `${integer(highestDiscount)}%`, "↘", "بين المنتجات المخفّضة")}
        ${metric("أكبر توفير للقطعة", money(biggestSaving), "◇", "قيمة الفرق على قطعة واحدة")}
      </div>
      ${toolbar("ابحثي باسم المنتج المخفّض…")}
      <section class="panel"><div class="table-wrap mobile-stack"><table class="data-table"><thead><tr><th>المنتج</th><th>الفئة</th><th>السعر الأصلي</th><th>الخصم</th><th>السعر بعد الخصم</th><th>إجراء</th></tr></thead><tbody>
      ${visible.length ? visible.map(product => `<tr>
        <td class="product-mobile-cell"><div class="product-cell">${productPhoto(product)}<span><span class="table-main">${esc(productName(product))}</span><span class="table-sub latin">${esc(product.name_en || "")}</span></span></div></td>
        <td data-label="الفئة">${esc(categoryName(product))}</td>
        <td data-label="السعر الأصلي" class="price"><s class="old-price">${money(product.price)}</s></td>
        <td data-label="الخصم"><span class="discount-badge">${integer(discountPercent(product))}%</span></td>
        <td data-label="السعر بعد الخصم" class="price"><strong class="sale-price">${money(discountedPrice(product))}</strong></td>
        <td data-label="إجراء" class="mobile-actions"><div class="table-actions"><button class="text-button" data-action="set-product-discount" data-id="${attr(product.id)}">تعديل الخصم</button><button class="text-button danger" data-action="remove-product-discount" data-id="${attr(product.id)}">إزالة الخصم</button></div></td>
      </tr>`).join("") : `<tr><td colspan="6" class="table-empty">${query ? "لا توجد نتائج مطابقة." : discounted.length ? "لا توجد نتائج مطابقة." : state.products.length ? "لا توجد خصومات مفعّلة. أضيفي خصمًا من صفحة المنتجات." : "أضيفي المنتجات أولًا ثم حددي خصمًا لكل منتج."}</td></tr>`}
      </tbody></table></div>${pagination("discounts", filtered.length, per)}</section>`;
  }
  function renderOrders() {
    const q = (state.filters.orders.q || "").trim().toLocaleLowerCase();
    const filter = state.filters.orders.status;
    const filtered = state.orders.filter(order => {
      const customer = order.customer || {};
      return (!filter || order.order_status === filter) &&
        (!q || `${order.order_number || ""} ${customer.full_name || ""} ${customer.phone || ""} ${customer.second_phone || ""}`.toLocaleLowerCase().includes(q));
    });
    const per = 15, current = Math.min(state.pages.orders || 1, Math.max(1, Math.ceil(filtered.length / per)));
    state.pages.orders = current;
    const visible = filtered.slice((current - 1) * per, current * per);
    return `${pageHeading("الطلبات", "راجعي تفاصيل الطلبات وحالات الدفع والتجهيز.")}
      ${toolbar("ابحثي برقم الطلب أو اسم العميل أو الهاتف…", statusFilter())}
      <section class="panel"><div class="table-wrap mobile-stack"><table class="data-table"><thead><tr><th>رقم الطلب</th><th>العميل</th><th>الإجمالي</th><th>العربون</th><th>الدفع</th><th>الحالة</th><th>تاريخ الطلب</th><th></th></tr></thead><tbody>
      ${visible.length ? visible.map(order => `<tr>
        <td data-label="رقم الطلب"><span class="table-main latin">${esc(order.order_number)}</span></td>
        <td data-label="العميل"><span class="table-main">${esc(customerName(order))}</span><span class="table-sub latin">${esc(order.customer?.phone || "")}</span></td>
        <td data-label="الإجمالي" class="price">${money(order.subtotal)}</td><td data-label="العربون" class="price">${money(order.deposit_amount)}</td>
        <td data-label="الدفع">${paymentStatusBadge(order.payment_status)}</td>
        <td data-label="الحالة"><select class="order-status-select" data-order-status="${attr(order.id)}" aria-label="تغيير حالة الطلب">${ORDER_STATUSES.map(([value,label]) => `<option value="${value}" ${value === order.order_status ? "selected" : ""}>${label}</option>`).join("")}</select></td>
        <td data-label="التاريخ" class="latin">${date(order.created_at)}</td><td data-label="التفاصيل" class="mobile-actions"><button class="text-button" data-action="order-details" data-id="${attr(order.id)}">التفاصيل</button></td>
      </tr>`).join("") : `<tr><td colspan="8" class="table-empty">${state.orders.length ? "لا توجد نتائج مطابقة." : "لا توجد طلبات حتى الآن."}</td></tr>`}
      </tbody></table></div>${pagination("orders", filtered.length, per)}</section>`;
  }
  function renderCategories() {
    const cards = state.categories.map(category => {
      const count = state.products.filter(product => product.category_id === category.id).length;
      return `<article class="category-card">${category.image_url ? `<span class="category-symbol category-photo"><img src="${attr(category.image_url)}" alt="" loading="lazy"></span>` : '<span class="category-symbol">◇</span>'}<div class="category-card-main"><h3>${esc(category.name_ar || category.name_en)}</h3><p>${esc(category.name_en || category.slug)} · ${integer(count)} منتج</p></div>
        <div class="category-card-actions"><button class="text-button" data-action="edit-category" data-id="${attr(category.id)}">تعديل</button><button class="text-button danger" data-action="delete-category" data-id="${attr(category.id)}">حذف</button></div></article>`;
    }).join("");
    return `${pageHeading("الفئات", "تنظيم المنتجات بين العناية بالبشرة والمكياج.", '<button class="button" data-action="add-category">＋ إضافة فئة</button>')}
      ${cards ? `<div class="category-grid">${cards}</div>` : '<div class="empty-state">لا توجد فئات مسجلة.</div>'}`;
  }
  function renderInventory() {
    const q = (state.filters.inventory.q || "").trim().toLocaleLowerCase();
    const filter = state.filters.inventory.stock;
    const filtered = state.products.filter(product => {
      const [label] = stockStatus(product);
      const matchesText = `${product.name_ar || ""} ${product.name_en || ""}`.toLocaleLowerCase().includes(q);
      return matchesText && (!filter || (filter === "out" ? !Number(product.stock_quantity) : filter === "low" ? Number(product.stock_quantity) > 0 && Number(product.stock_quantity) <= Number(state.settings.low_stock_threshold ?? 5) : Number(product.stock_quantity) > Number(state.settings.low_stock_threshold ?? 5)));
    });
    const per = 15, current = Math.min(state.pages.inventory || 1, Math.max(1, Math.ceil(filtered.length / per)));
    state.pages.inventory = current;
    const visible = filtered.slice((current - 1) * per, current * per);
    return `${pageHeading("المخزون", "تابعي الكميات وحدّثي الرصيد؛ تنفّذ قواعد قاعدة البيانات خصم الطلبات واستعادتها.")}
      ${toolbar("ابحثي باسم المنتج…", `<select class="filter-select" data-stock-filter><option value="" ${!state.filters.inventory.stock ? "selected" : ""}>كل الحالات</option><option value="available" ${state.filters.inventory.stock === "available" ? "selected" : ""}>متوفر</option><option value="low" ${state.filters.inventory.stock === "low" ? "selected" : ""}>مخزون منخفض</option><option value="out" ${state.filters.inventory.stock === "out" ? "selected" : ""}>نفد المخزون</option></select>`)}
      <section class="panel"><div class="table-wrap mobile-stack"><table class="data-table"><thead><tr><th>المنتج</th><th>الفئة</th><th>الرصيد</th><th>الحالة</th><th>تحديث المخزون</th></tr></thead><tbody>
      ${visible.length ? visible.map(product => { const [label, cls] = stockStatus(product); return `<tr>
        <td class="product-mobile-cell"><div class="product-cell">${productPhoto(product)}<span><span class="table-main">${esc(productName(product))}</span><span class="table-sub latin">${esc(product.name_en || "")}</span></span></div></td>
        <td data-label="الفئة">${esc(categoryName(product))}</td><td data-label="الرصيد" class="latin">${integer(product.stock_quantity)}</td><td data-label="الحالة"><span class="status ${cls}">${label}</span></td>
        <td data-label="تحديث" class="mobile-actions"><button class="button button-secondary button-small" data-action="edit-stock" data-id="${attr(product.id)}">تعديل الرصيد</button></td>
      </tr>`; }).join("") : `<tr><td colspan="5" class="table-empty">لا توجد منتجات مطابقة.</td></tr>`}
      </tbody></table></div>${pagination("inventory", filtered.length, per)}</section>`;
  }
  function customerOrderTotal(customer) {
    const orders = state.orders.filter(order => order.customer_id === customer.id);
    return orders.filter(order => order.order_status !== "cancelled").reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
  }
  function renderCustomers() {
    const q = (state.filters.customers.q || "").trim().toLocaleLowerCase();
    const filtered = state.customers.filter(customer => `${customer.full_name || ""} ${customer.phone || ""} ${customer.second_phone || ""}`.toLocaleLowerCase().includes(q));
    const per = 15, current = Math.min(state.pages.customers || 1, Math.max(1, Math.ceil(filtered.length / per)));
    state.pages.customers = current;
    const visible = filtered.slice((current - 1) * per, current * per);
    return `${pageHeading("العملاء", "بيانات العملاء وسجل طلباتهم المسجلة.")}
      ${toolbar("ابحثي بالاسم أو رقم الهاتف…")}
      <section class="panel"><div class="table-wrap mobile-stack"><table class="data-table"><thead><tr><th>العميل</th><th>الهاتف</th><th>المحافظة</th><th>الطلبات</th><th>إجمالي الإنفاق</th><th>آخر طلب</th><th></th></tr></thead><tbody>
      ${visible.length ? visible.map(customer => { const orders = state.orders.filter(order => order.customer_id === customer.id).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)); const last = orders[0]; return `<tr>
        <td data-label="العميل"><span class="table-main">${esc(customer.full_name || "—")}</span><span class="table-sub">${esc(customer.governorate || "")}</span></td>
        <td data-label="الهاتف" class="latin">${esc(customer.phone || "—")}${customer.second_phone ? `<span class="table-sub latin">${esc(customer.second_phone)}</span>` : ""}</td>
        <td data-label="المحافظة">${esc(customer.governorate || "—")}</td><td data-label="الطلبات" class="latin">${integer(orders.length)}</td>
        <td data-label="إجمالي الإنفاق" class="price">${money(customerOrderTotal(customer))}</td><td data-label="آخر طلب" class="latin">${last ? date(last.created_at) : "—"}</td>
        <td data-label="السجل" class="mobile-actions"><button class="text-button" data-action="customer-history" data-id="${attr(customer.id)}">سجل الطلبات</button></td>
      </tr>`; }).join("") : `<tr><td colspan="7" class="table-empty">${state.customers.length ? "لا توجد نتائج مطابقة." : "لا توجد بيانات عملاء بعد."}</td></tr>`}
      </tbody></table></div>${pagination("customers", filtered.length, per)}</section>`;
  }
  function renderPayments() {
    const setting = state.settings;
    return `${pageHeading("المدفوعات", "إعداد وسائل الدفع ونسبة العربون المستخدمة في الطلبات.")}
      <div class="payment-grid">
        <section class="payment-card"><h3>InstaPay</h3><form data-form="payment-settings"><input type="hidden" name="section" value="payment">
          <div class="field"><label for="instapay">حساب InstaPay</label><input id="instapay" name="instapay_account" value="${attr(setting.instapay_account || "")}" placeholder="اسم الحساب أو المعرّف"></div>
          <button class="button" type="submit">حفظ إعدادات الدفع</button></form></section>
        <section class="payment-card"><h3>Vodafone Cash</h3><form data-form="payment-settings"><input type="hidden" name="section" value="payment">
          <div class="field"><label for="vodafone">رقم Vodafone Cash</label><input id="vodafone" name="vodafone_cash_number" inputmode="tel" value="${attr(setting.vodafone_cash_number || "")}" placeholder="رقم المحفظة"></div>
          <button class="button" type="submit">حفظ إعدادات الدفع</button></form></section>
        <section class="payment-card"><h3>العربون</h3><form data-form="payment-settings"><input type="hidden" name="section" value="payment">
          <div class="field"><label for="depositPct">نسبة العربون (%)</label><input id="depositPct" name="deposit_percentage" type="number" min="0" max="100" step="0.01" value="${attr(setting.deposit_percentage ?? 30)}" required><small>تُطبّق النسبة على الطلبات الجديدة؛ تُحفظ قيمة النسبة داخل الطلب.</small></div>
          <button class="button" type="submit">حفظ النسبة</button></form></section>
        <section class="payment-card"><h3>العملة والرصيد</h3><form data-form="payment-settings"><input type="hidden" name="section" value="payment">
          <div class="field"><label for="currency">رمز العملة</label><input id="currency" name="currency" maxlength="8" value="${attr(setting.currency || "EGP")}" required></div>
          <button class="button" type="submit">حفظ العملة</button></form></section>
      </div>`;
  }
  function renderSettings() {
    const setting = state.settings;
    return `${pageHeading("الإعدادات", "تفضيلات المتجر وحدود تنبيهات المخزون.")}
      <div class="settings-grid"><section class="panel"><header class="panel-header"><div><h3>إعدادات المتجر</h3><p>تُحفظ القيم في Supabase وتُستخدم في حسابات الطلبات الجديدة.</p></div></header>
        <div class="panel-content"><form class="settings-form" data-form="store-settings">
          <div class="field"><label for="storeName">اسم المتجر</label><input id="storeName" name="store_name" value="${attr(setting.store_name || "LEN")}" required></div>
          <div class="field"><label for="lowStock">تنبيه المخزون المنخفض عند</label><input id="lowStock" name="low_stock_threshold" type="number" min="0" step="1" value="${attr(setting.low_stock_threshold ?? 5)}" required><small>عدد القطع، بالأرقام الإنجليزية.</small></div>
          <div class="field"><label for="defaultCurrency">رمز العملة</label><input id="defaultCurrency" name="currency" maxlength="8" value="${attr(setting.currency || "EGP")}" required></div>
          <div class="field"><label for="defaultDeposit">نسبة العربون (%)</label><input id="defaultDeposit" name="deposit_percentage" type="number" min="0" max="100" step="0.01" value="${attr(setting.deposit_percentage ?? 30)}" required></div>
          <div class="field full"><div class="settings-foot"><span class="table-sub">لا تتغير نسب العربون المحفوظة في الطلبات السابقة.</span><button class="button" type="submit">حفظ التغييرات</button></div></div>
        </form></div></section>
        <aside class="security-card"><h3>حماية لوحة الإدارة</h3><p>لا توجد صفحة تسجيل دخول داخل LEN. يجب تشغيل هذه اللوحة خلف بوابة وصول خاصة تتحقق من هوية المشرف قبل تحميل الصفحة أو تمرير أي طلب.</p><p>مفتاح Supabase الإداري محفوظ في وسيط الخادم، ولا يُرسل إلى المتصفح. سياسات RLS تمنع القراءة والكتابة العامة لبيانات الطلبات والعملاء.</p><div class="security-badge"><span>●</span><span>الوصول الخاص مطلوب قبل النشر</span></div></aside>
      </div>`;
  }
  function showModal({ title, eyebrow = "LEN · إدارة", body, footer = "", onOpen }) {
    $("#modalTitle").textContent = title;
    $("#modalEyebrow").textContent = eyebrow;
    $("#modalBody").innerHTML = body;
    $("#modalFooter").innerHTML = footer;
    $("#modalBackdrop").hidden = false;
    document.body.style.overflow = "hidden";
    if (onOpen) onOpen();
    const focusable = $("#modalBody input, #modalBody select, #modalBody button", $("#modal"));
    if (focusable) focusable.focus();
  }
  function closeModal() {
    $("#modalBackdrop").hidden = true;
    document.body.style.overflow = "";
  }
  function field(name, label, value = "", { type = "text", required = false, placeholder = "", min, max, step, full = false, options = "", maxlength = "", hint = "" } = {}) {
    const id = `field-${name}`;
    const common = `id="${id}" name="${name}" ${required ? "required" : ""} ${placeholder ? `placeholder="${attr(placeholder)}"` : ""} ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} ${step !== undefined ? `step="${step}"` : ""} ${maxlength ? `maxlength="${maxlength}"` : ""}`;
    return `<div class="field ${full ? "full" : ""}"><label for="${id}">${label}</label>${options ? `<select ${common}>${options}</select>` : type === "textarea" ? `<textarea ${common}>${esc(value)}</textarea>` : `<input ${common} type="${type}" value="${attr(value)}">`}${hint ? `<small>${esc(hint)}</small>` : ""}</div>`;
  }
  function openProductForm(product = null) {
    const editing = Boolean(product);
    const options = state.categories.map(category => `<option value="${attr(category.id)}" ${product?.category_id === category.id ? "selected" : ""}>${esc(category.name_ar || category.name_en)}</option>`).join("");
    const imageRows = product?.images || [];
    const registeredUrls = new Set(imageRows.map(image => image.image_url));
    const imageTiles = imageRows.map(image => {
      const isMain = product?.image_url === image.image_url;
      return `<div class="image-preview"><img src="${attr(image.image_url)}" alt=""><div class="image-tools">${!isMain ? `<button class="image-tool" type="button" data-action="main-image" data-id="${attr(image.id)}" title="تعيين كصورة رئيسية" aria-label="تعيين كصورة رئيسية">★</button>` : ""}<button class="image-tool" type="button" data-action="remove-image" data-id="${attr(image.id)}" title="حذف الصورة" aria-label="حذف الصورة">×</button></div><small>${isMain ? "رئيسية" : "محفوظة"}</small></div>`;
    }).join("");
    const unlistedMain = product?.image_url && !registeredUrls.has(product.image_url)
      ? `<div class="image-preview"><img src="${attr(product.image_url)}" alt=""><small>رئيسية</small></div>` : "";
    showModal({
      title: editing ? "تعديل المنتج" : "إضافة منتج",
      body: `<form id="productForm" class="form-grid" data-form="product">
        <input type="hidden" name="id" value="${attr(product?.id || "")}">
        <h3 class="form-section-title">بيانات المنتج</h3>
        ${field("name_en", "الاسم بالإنجليزية", product?.name_en || "", { required: true, placeholder: "Product name" })}
        ${field("name_ar", "الاسم بالعربية", product?.name_ar || "", { required: true, placeholder: "اسم المنتج", full: true })}
        ${field("description_en", "الوصف بالإنجليزية", product?.description_en || "", { type: "textarea" })}
        ${field("description_ar", "الوصف بالعربية", product?.description_ar || "", { type: "textarea" })}
        ${field("category_id", "الفئة", product?.category_id || "", { required: true, options: `<option value="">اختاري فئة</option>${options}` })}
        ${field("price", "السعر", product?.price ?? "", { type: "number", min: "0", step: "0.01", required: true })}
        ${field("discount_percentage", "نسبة الخصم (%)", product?.discount_percentage ?? 0, { type: "number", min: "0", max: "100", step: "0.01", hint: "من 0 إلى 100٪ — أدخلي 0 لإلغاء الخصم." })}
        ${field("stock_quantity", "الكمية في المخزون", product?.stock_quantity ?? 0, { type: "number", min: "0", step: "1", required: true })}
        ${field("is_active", "حالة المنتج", "", { options: `<option value="true" ${product?.is_active !== false ? "selected" : ""}>نشط</option><option value="false" ${product?.is_active === false ? "selected" : ""}>غير نشط</option>` })}
        <div class="field full"><label for="productImages">صور المنتج</label><div class="image-picker"><input id="productImages" name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple><span class="table-sub">حتى 10 ميغابايت للصورة.</span></div>
          <label class="table-sub"><input id="makeMainImage" name="make_main" type="checkbox" ${!product?.image_url ? "checked" : ""}> اجعلي الصورة الجديدة الأولى الصورة الرئيسية</label>
          <div class="image-preview-row" id="currentImages">${imageTiles}${unlistedMain}</div>
          <div class="image-preview-row" id="newImagePreviews"></div></div>
      </form>`,
      footer: `<button class="button button-secondary" type="button" data-modal-cancel>إلغاء</button><button class="button" type="submit" form="productForm">${editing ? "حفظ المنتج" : "إضافة المنتج"}</button>`
    });
    $("#productImages").addEventListener("change", event => {
      const holder = $("#newImagePreviews");
      holder.innerHTML = "";
      [...event.target.files].slice(0, 10).forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = () => holder.insertAdjacentHTML("beforeend", `<div class="image-preview"><img src="${attr(reader.result)}" alt=""><small>${index === 0 && $("#makeMainImage").checked ? "رئيسية" : "جديدة"}</small></div>`);
        reader.readAsDataURL(file);
      });
    });
  }
  function openCategoryForm(category = null) {
    const editing = Boolean(category);
    showModal({
      title: editing ? "تعديل الفئة" : "إضافة فئة",
      body: `<form id="categoryForm" class="form-grid" data-form="category"><input type="hidden" name="id" value="${attr(category?.id || "")}">
        ${field("name_en", "الاسم بالإنجليزية", category?.name_en || "", { required: true, placeholder: "Skin Care" })}
        ${field("name_ar", "الاسم بالعربية", category?.name_ar || "", { required: true, placeholder: "العناية بالبشرة" })}
        ${field("slug", "المعرّف المختصر", category?.slug || "", { required: true, placeholder: "skin-care" })}
        <div class="field full"><label for="categoryImage">صورة الفئة (تظهر في واجهة المتجر)</label><div class="image-picker"><input id="categoryImage" name="category_image" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><span class="table-sub">حتى 10 ميغابايت.</span></div>
          <div class="image-preview-row" id="categoryImagePreview">${category?.image_url ? `<div class="image-preview category-image-preview"><img src="${attr(category.image_url)}" alt=""><small>الحالية</small></div>` : ""}</div>
          ${category?.image_url ? '<label class="table-sub"><input name="remove_image" type="checkbox"> حذف صورة الفئة</label>' : ""}</div></form>`,
      footer: `<button class="button button-secondary" type="button" data-modal-cancel>إلغاء</button><button class="button" type="submit" form="categoryForm">${editing ? "حفظ الفئة" : "إضافة الفئة"}</button>`
    });
    $("#categoryImage").addEventListener("change", event => {
      const file = event.target.files[0];
      const holder = $("#categoryImagePreview");
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { holder.innerHTML = `<div class="image-preview category-image-preview"><img src="${attr(reader.result)}" alt=""><small>جديدة</small></div>`; };
      reader.readAsDataURL(file);
    });
  }
  function openStockForm(product) {
    showModal({
      title: "تحديث المخزون",
      body: `<form id="stockForm" class="form-grid" data-form="stock"><input type="hidden" name="id" value="${attr(product.id)}">
        <div class="detail-item full"><span class="detail-label">المنتج</span><span class="detail-value">${esc(productName(product))}</span></div>
        ${field("stock_quantity", "الكمية الجديدة", product.stock_quantity, { type: "number", min: "0", step: "1", required: true })}
        <div class="field"><label>الحالة الحالية</label><div class="detail-value">${stockStatus(product)[0]}</div></div></form>`,
      footer: '<button class="button button-secondary" type="button" data-modal-cancel>إلغاء</button><button class="button" type="submit" form="stockForm">حفظ الكمية</button>'
    });
  }
  function orderItems(order) {
    return Array.isArray(order.items) ? order.items : [];
  }
  function openOrderDetails(order) {
    const customer = order.customer || {};
    const items = orderItems(order);
    const address = [customer.governorate, customer.address].filter(Boolean).join(" — ") || "—";
    showModal({
      title: `تفاصيل الطلب ${order.order_number || ""}`,
      body: `<div class="detail-grid">
        <div class="detail-item"><span class="detail-label">اسم العميل</span><span class="detail-value">${esc(customer.full_name || "—")}</span></div>
        <div class="detail-item"><span class="detail-label">الهاتف</span><span class="detail-value latin">${esc(customer.phone || "—")}${customer.second_phone ? ` · ${esc(customer.second_phone)}` : ""}</span></div>
        <div class="detail-item full"><span class="detail-label">العنوان</span><span class="detail-value">${esc(address)}</span></div>
        <div class="detail-item full"><span class="detail-label">ملاحظات العميل</span><span class="detail-value">${esc(order.notes || customer.notes || "—")}</span></div>
        <div class="detail-item"><span class="detail-label">طريقة الدفع</span><span class="detail-value">${order.payment_method === "instapay" ? "InstaPay" : order.payment_method === "vodafone_cash" ? "Vodafone Cash" : esc(order.payment_method || "—")}</span></div>
        <div class="detail-item"><span class="detail-label">حالة الدفع</span><span class="detail-value">${esc(PAYMENT_LABELS[order.payment_status] || order.payment_status || "—")}</span></div>
        <div class="detail-item"><span class="detail-label">حالة الطلب</span><span class="detail-value">${esc(ORDER_LABELS[order.order_status] || order.order_status || "—")}</span></div>
        <div class="detail-item"><span class="detail-label">تاريخ الطلب</span><span class="detail-value latin">${date(order.created_at)}</span></div>
      </div>
      <table class="line-items"><thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
        ${items.length ? items.map(item => `<tr><td>${esc(item.product_name_ar || item.product_name_en || item.product?.name_ar || item.product?.name_en || "منتج")}</td><td class="latin">${integer(item.quantity)}</td><td class="price">${money(item.unit_price)}</td><td class="price">${money(item.total_price)}</td></tr>`).join("") : '<tr><td colspan="4">لا توجد تفاصيل للمنتجات.</td></tr>'}
      </tbody></table>
      <div class="detail-grid" style="margin-top:13px">
        <div class="detail-item"><span class="detail-label">الإجمالي الفرعي</span><span class="detail-value price">${money(order.subtotal)}</span></div>
        <div class="detail-item"><span class="detail-label">العربون · ${integer(order.deposit_percentage)}%</span><span class="detail-value price">${money(order.deposit_amount)}</span></div>
        <div class="detail-item"><span class="detail-label">المتبقي</span><span class="detail-value price">${money(order.remaining_amount)}</span></div>
        <div class="detail-item"><span class="detail-label">رقم إضافي للمخزون</span><span class="detail-value">${order.stock_deducted ? "تم خصم الكمية" : "لم يتم الخصم"}</span></div>
      </div>`,
      footer: `<button class="button button-secondary" type="button" data-modal-cancel>إغلاق</button>${order.payment_status !== "deposit_received" ? `<button class="button" type="button" data-action="mark-deposit" data-id="${attr(order.id)}">تأكيد استلام العربون</button>` : ""}`
    });
  }
  function openCustomerHistory(customer) {
    const orders = state.orders.filter(order => order.customer_id === customer.id).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    showModal({
      title: `سجل ${customer.full_name || "العميل"}`,
      body: `<div class="detail-grid">
        <div class="detail-item"><span class="detail-label">الهاتف</span><span class="detail-value latin">${esc(customer.phone || "—")}</span></div>
        <div class="detail-item"><span class="detail-label">هاتف إضافي</span><span class="detail-value latin">${esc(customer.second_phone || "—")}</span></div>
        <div class="detail-item full"><span class="detail-label">العنوان</span><span class="detail-value">${esc([customer.governorate, customer.address].filter(Boolean).join(" — ") || "—")}</span></div>
      </div>
      <h3 class="form-section-title" style="margin-top:16px">الطلبات (${integer(orders.length)})</h3>
      ${orders.length ? orders.map(order => `<div class="customer-order"><span><bdi class="latin">${esc(order.order_number)}</bdi> · ${esc(ORDER_LABELS[order.order_status] || order.order_status)}</span><span class="price">${money(order.subtotal)}</span></div>`).join("") : '<p class="table-sub">لا توجد طلبات سابقة.</p>'}`,
      footer: '<button class="button button-secondary" type="button" data-modal-cancel>إغلاق</button>'
    });
  }
  async function perform(path, method, body) {
    const options = { method };
    if (body !== undefined) options.body = JSON.stringify(body);
    const result = await api(path, options);
    await loadData({ quiet: true });
    return result;
  }
  async function uploadImages(productId, files, makeMain) {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const objectPath = `${productId}/${Date.now()}-${index}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Content-Type": file.type, "x-upsert": "true" },
        body: file
      });
      if (!upload.ok) throw new Error("تعذر رفع الصورة إلى التخزين.");
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
      const isMain = makeMain && index === 0;
      await api("/product_images", { method: "POST", body: JSON.stringify({ product_id: productId, image_url: imageUrl, is_main: isMain }) });
      if (isMain) await api(`/products/${encodeURIComponent(productId)}`, { method: "PATCH", body: JSON.stringify({ image_url: imageUrl }) });
    }
  }
  async function uploadCategoryImage(slug, file) {
    const objectPath = `categories/${slug}-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Content-Type": file.type, "x-upsert": "true" },
      body: file
    });
    if (!upload.ok) throw new Error("تعذر رفع صورة الفئة إلى التخزين.");
    return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
  }
  async function handleProductSubmit(form) {
    const data = new FormData(form);
    const id = String(data.get("id") || "");
    const product = {
      name_en: String(data.get("name_en") || "").trim(),
      name_ar: String(data.get("name_ar") || "").trim(),
      description_en: String(data.get("description_en") || "").trim(),
      description_ar: String(data.get("description_ar") || "").trim(),
      category_id: String(data.get("category_id") || ""),
      price: Number(data.get("price")),
      discount_percentage: Number(data.get("discount_percentage") || 0),
      stock_quantity: Number(data.get("stock_quantity")),
      is_active: String(data.get("is_active")) === "true"
    };
    if (!product.name_en || !product.name_ar || !product.category_id || !Number.isFinite(product.price) || product.price < 0 || !Number.isFinite(product.discount_percentage) || product.discount_percentage < 0 || product.discount_percentage > 100 || !Number.isInteger(product.stock_quantity) || product.stock_quantity < 0) {
      throw new Error("أكملي الحقول المطلوبة وتحققي من السعر والكمية.");
    }
    const files = [...($("#productImages")?.files || [])];
    if (files.some(file => !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024)) throw new Error("اختاري صورًا صالحة بحجم لا يتجاوز 10 ميغابايت للصورة.");
    const saved = id ? await api(`/products/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(product) }) : await api("/products", { method: "POST", body: JSON.stringify(product) });
    const productId = id || saved?.id || saved?.[0]?.id;
    if (!productId) throw new Error("تم حفظ المنتج لكن تعذر تحديد معرّفه لرفع الصور.");
    if (files.length) {
      await uploadImages(productId, files, Boolean($("#makeMainImage")?.checked));
    }
    closeModal();
    toast(id ? "تم تحديث المنتج." : "تمت إضافة المنتج.");
    await loadData({ quiet: true });
  }
  function formObject(form) {
    const object = {};
    new FormData(form).forEach((value, key) => { if (key !== "section" && key !== "id") object[key] = value; });
    return object;
  }
  async function handleSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const submitButton = $$("button[type=submit]", form).at(-1);
    if (submitButton) { submitButton.disabled = true; submitButton.dataset.label = submitButton.textContent; submitButton.textContent = "جارٍ الحفظ…"; }
    try {
      if (form.dataset.form === "product") {
        await handleProductSubmit(form);
      } else if (form.dataset.form === "category") {
        const data = formObject(form);
        const id = String(new FormData(form).get("id") || "");
        data.slug = String(data.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
        if (!data.name_en.trim() || !data.name_ar.trim() || !data.slug) throw new Error("أكملي اسمَي الفئة والمعرّف المختصر.");
        const removeImage = data.remove_image === "on";
        delete data.category_image; delete data.remove_image;
        const imageFile = $("#categoryImage")?.files?.[0];
        if (imageFile) {
          if (!imageFile.type.startsWith("image/") || imageFile.size > 10 * 1024 * 1024) throw new Error("اختاري صورة صالحة بحجم لا يتجاوز 10 ميغابايت.");
          data.image_url = await uploadCategoryImage(data.slug, imageFile);
        } else if (removeImage) data.image_url = null;
        await perform(id ? `/categories/${encodeURIComponent(id)}` : "/categories", id ? "PATCH" : "POST", data);
        closeModal(); toast(id ? "تم تحديث الفئة." : "تمت إضافة الفئة.");
      } else if (form.dataset.form === "stock") {
        const data = new FormData(form), id = String(data.get("id"));
        const stock = Number(data.get("stock_quantity"));
        if (!Number.isInteger(stock) || stock < 0) throw new Error("أدخلي كمية صحيحة لا تقل عن صفر.");
        await perform(`/inventory/${encodeURIComponent(id)}`, "PATCH", { stock_quantity: stock });
        closeModal(); toast("تم تحديث المخزون.");
      } else if (form.dataset.form === "payment-settings" || form.dataset.form === "store-settings") {
        const raw = formObject(form);
        const data = {};
        for (const [key, value] of Object.entries(raw)) {
          data[key] = ["deposit_percentage", "low_stock_threshold"].includes(key) ? Number(value) : String(value).trim();
        }
        if (data.deposit_percentage !== undefined && (!Number.isFinite(data.deposit_percentage) || data.deposit_percentage < 0 || data.deposit_percentage > 100)) throw new Error("يجب أن تكون نسبة العربون بين 0 و100.");
        if (data.low_stock_threshold !== undefined && (!Number.isInteger(data.low_stock_threshold) || data.low_stock_threshold < 0)) throw new Error("حد المخزون يجب أن يكون عددًا صحيحًا.");
        const id = state.settings.id;
        if (!id) throw new Error("لم يتم العثور على سجل إعدادات المتجر.");
        await perform(`/settings/${encodeURIComponent(id)}`, "PATCH", data);
        toast("تم حفظ الإعدادات.");
      }
    } catch (error) {
      toast(error.message || "تعذر حفظ التغييرات.", "error");
    } finally {
      if (submitButton?.isConnected) { submitButton.disabled = false; submitButton.textContent = submitButton.dataset.label || "حفظ"; }
    }
  }
  function confirmAction(message, callback) {
    showModal({
      title: "تأكيد الإجراء",
      body: `<p class="detail-value">${esc(message)}</p>`,
      footer: '<button class="button button-secondary" type="button" data-modal-cancel>رجوع</button><button class="button button-danger" type="button" data-action="confirm-pending">تأكيد</button>'
    });
    $("#modal").dataset.pendingAction = "yes";
    $("#modal")._confirmCallback = callback;
  }
  async function runAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "refresh") return loadData();
    if (action === "add-product") return openProductForm();
    if (action === "edit-product") return openProductForm(state.products.find(item => item.id === id));
    if (action === "set-product-discount") return openProductForm(state.products.find(item => item.id === id));
    if (action === "remove-product-discount") {
      await perform(`/products/${encodeURIComponent(id)}`, "PATCH", { discount_percentage: 0 });
      toast("تمت إزالة الخصم.");
      return;
    }
    if (action === "add-category") return openCategoryForm();
    if (action === "edit-category") return openCategoryForm(state.categories.find(item => item.id === id));
    if (action === "edit-stock") return openStockForm(state.products.find(item => item.id === id));
    if (action === "order-details") return openOrderDetails(state.orders.find(item => item.id === id));
    if (action === "customer-history") return openCustomerHistory(state.customers.find(item => item.id === id));
    if (action === "main-image") {
      const productId = $("#productForm input[name=id]")?.value;
      await perform(`/images/${encodeURIComponent(id)}/main`, "PATCH", {});
      toast("تم تعيين الصورة الرئيسية.");
      closeModal();
      const updated = state.products.find(item => item.id === productId);
      if (updated) openProductForm(updated);
      return;
    }
    if (action === "remove-image") {
      const productId = $("#productForm input[name=id]")?.value;
      return confirmAction("حذف هذه الصورة من المنتج نهائيًا؟", async () => {
        await perform(`/images/${encodeURIComponent(id)}`, "DELETE");
        toast("تم حذف الصورة.");
        const updated = state.products.find(item => item.id === productId);
        if (updated) openProductForm(updated);
      });
    }
    if (action === "toggle-product") {
      const product = state.products.find(item => item.id === id);
      if (!product) return;
      await perform(`/products/${encodeURIComponent(id)}`, "PATCH", { is_active: !product.is_active });
      toast(product.is_active ? "تم إيقاف المنتج." : "تم تفعيل المنتج.");
      return;
    }
    if (action === "delete-product") return confirmAction("سيُحذف المنتج من المتجر. ستبقى تفاصيله المحفوظة داخل الطلبات السابقة.", async () => {
      await perform(`/products/${encodeURIComponent(id)}`, "DELETE");
      toast("تم حذف المنتج.");
    });
    if (action === "delete-category") return confirmAction("سيتم حذف الفئة إذا لم تعد مرتبطة بمنتجات.", async () => {
      await perform(`/categories/${encodeURIComponent(id)}`, "DELETE");
      toast("تم حذف الفئة.");
    });
    if (action === "mark-deposit") {
      const order = state.orders.find(item => item.id === id);
      if (!order) return;
      closeModal();
      return confirmAction("تأكيد استلام العربون لهذا الطلب؟", async () => {
        await perform(`/orders/${encodeURIComponent(id)}/payment`, "PATCH", { payment_status: "deposit_received" });
        toast("تم تحديث حالة الدفع.");
        const updated = state.orders.find(item => item.id === id);
        if (updated) openOrderDetails(updated);
      });
    }
    if (action === "confirm-pending") {
      const callback = $("#modal")._confirmCallback;
      closeModal();
      if (callback) {
        try { await callback(); } catch (error) { toast(error.message || "تعذر تنفيذ الإجراء.", "error"); }
      }
    }
  }
  async function handleChange(event) {
    const target = event.target;
    if (target.matches("[data-order-status]")) {
      const id = target.dataset.orderStatus;
      const next = target.value;
      const order = state.orders.find(item => item.id === id);
      if (!order || order.order_status === next) return;
      const previous = order.order_status;
      target.disabled = true;
      try {
        await perform(`/orders/${encodeURIComponent(id)}/status`, "PATCH", { order_status: next });
        toast("تم تحديث حالة الطلب والمخزون.");
      } catch (error) {
        target.value = previous;
        toast(error.message || "تعذر تغيير حالة الطلب.", "error");
      } finally { target.disabled = false; }
    }
    if (target.matches("[data-order-filter]")) state.filters.orders.status = target.value;
    else if (target.matches("[data-category-filter]")) state.filters.products.category = target.value;
    else if (target.matches("[data-active-filter]")) state.filters.products.active = target.value;
    else if (target.matches("[data-stock-filter]")) state.filters.inventory.stock = target.value;
    else return;
    state.pages[state.view] = 1;
    render();
  }
  function handleInput(event) {
    const target = event.target;
    if (!target.matches("[data-search]")) return;
    const filter = state.filters[state.view];
    if (!filter) return;
    filter.q = target.value;
    state.pages[state.view] = 1;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    render();
    const next = content.querySelector("[data-search]");
    if (next) {
      next.focus();
      if (start !== null && end !== null) next.setSelectionRange(start, end);
    }
  }
  function handleClick(event) {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      state.view = viewButton.dataset.view;
      render();
      return;
    }
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      state.pages[pageButton.dataset.page] = Number(pageButton.dataset.number);
      render();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      runAction(actionButton).catch(error => toast(error.message || "تعذر تنفيذ الإجراء.", "error"));
      return;
    }
    if (event.target.closest("[data-modal-cancel]") || event.target.id === "modalClose" || event.target.id === "modalBackdrop") closeModal();
  }
  function bind() {
    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit);
    document.addEventListener("change", handleChange);
    document.addEventListener("input", handleInput);
    $("#refreshButton").addEventListener("click", () => loadData());
    $("#menuToggle").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#sidebarScrim").classList.add("open"); });
    $("#sidebarScrim").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#sidebarScrim").classList.remove("open"); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#modalBackdrop").hidden) closeModal(); });
  }
  bind();
  loadData();
})()
