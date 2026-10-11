const STORAGE_KEY = "linkitos-v1";
const categoryMeta = {
  Ropa: "👗", Discos: "♫", Hogar: "⌂", Muebles: "🪑", Libros: "▤", Juguetes: "✿",
};
const starterData = {
  categories: ["Ropa", "Discos", "Hogar", "Muebles", "Libros", "Juguetes"],
  items: [
    { id: "sample-1", title: "Bolso mini de piel trenzada", category: "Ropa", price: 89, url: "https://www.arket.com/", image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85", notes: "En color avellana", favorite: true, createdAt: Date.now() - 1000 * 60 * 60 * 3 },
    { id: "sample-2", title: "Vinilo · Rumours", category: "Discos", price: 31.5, url: "https://www.discogs.com/", image: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?auto=format&fit=crop&w=900&q=85", notes: "La edición remasterizada", favorite: false, createdAt: Date.now() - 1000 * 60 * 60 * 16 },
    { id: "sample-3", title: "Jarrón de cerámica artesanal", category: "Hogar", price: 42, url: "https://www.etsy.com/", image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85", notes: "Quedaría genial en la estantería", favorite: false, createdAt: Date.now() - 1000 * 60 * 60 * 33 },
    { id: "sample-4", title: "Lámpara de mesa de lino", category: "Muebles", price: 119, url: "https://www.ikea.com/", image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85", notes: "Luz cálida para el dormitorio", favorite: true, createdAt: Date.now() - 1000 * 60 * 60 * 72 },
    { id: "sample-5", title: "La casa de los espíritus", category: "Libros", price: 18.95, url: "https://www.bookshop.org/", image: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=900&q=85", notes: "Recomendación de Clara", favorite: false, createdAt: Date.now() - 1000 * 60 * 60 * 120 },
    { id: "sample-6", title: "Kit de construcción de madera", category: "Juguetes", price: 26, url: "https://www.amazon.es/", image: "https://images.unsplash.com/photo-1599629954294-14df9ec8f0e7?auto=format&fit=crop&w=900&q=85", notes: "Para el cumple de Leo", favorite: false, createdAt: Date.now() - 1000 * 60 * 60 * 180 },
  ],
};
let data;
let localSavedData;
try { localSavedData = JSON.parse(localStorage.getItem(STORAGE_KEY)); data = localSavedData || structuredClone(starterData); }
catch { data = structuredClone(starterData); }
let currentFilter = "all";
let sortMode = "recent";
let toastTimer;
let supabase = null;
let currentUser = null;
let cloudCategoryRows = [];
let cloudMode = false;
let authMode = "signIn";
let busy = false;
let liveChannel = null;

const $ = (selector) => document.querySelector(selector);
const itemGrid = $("#item-grid");
const categoryList = $("#category-list");
const itemModal = $("#item-modal");
const categoryModal = $("#category-modal");

function persist() { localStorage.setItem(cloudMode && currentUser ? `${STORAGE_KEY}-${currentUser.id}` : STORAGE_KEY, JSON.stringify(data)); }
function setSyncStatus(state, message) {
  const status = $("#sync-status");
  if (!status) return;
  status.className = `sync-status ${state === "syncing" ? "syncing" : state === "offline" ? "offline" : ""}`;
  status.lastElementChild.textContent = message || (state === "syncing" ? "Sincronizando" : state === "offline" ? "Sin conexión" : "Sincronizado");
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll(".primary-button").forEach((button) => { button.disabled = value; });
}
function setAuthError(message = "") { $("#auth-error").textContent = message; }
function showAuth() {
  document.body.classList.add("auth-gate");
  $("#auth-screen").classList.add("visible");
}
function hideAuth() {
  document.body.classList.remove("auth-gate");
  $("#auth-screen").classList.remove("visible");
}
function setProfile(user) {
  const email = user?.email || "Mi espacio personal";
  const initial = email.charAt(0).toUpperCase() || "M";
  $("#profile-name").textContent = email.split("@")[0] || "Mi colección";
  $("#profile-email").textContent = email;
  $("#profile-avatar").textContent = initial;
  $("#top-avatar").textContent = initial;
}
function mapCloudItem(row) {
  const category = cloudCategoryRows.find((entry) => entry.id === row.category_id)?.name || "Sin categoría";
  return { id: row.id, title: row.title, category, price: row.price ?? "", url: row.url, image: row.image_url || "", notes: row.notes || "", favorite: row.favorite, createdAt: new Date(row.created_at).getTime() };
}
function categoryIdFor(name) { return cloudCategoryRows.find((entry) => entry.name === name)?.id; }
async function loadCloudData() {
  setSyncStatus("syncing");
  const [categoryResult, itemResult] = await Promise.all([
    supabase.from("linkitos_categories").select("id,name,created_at").order("created_at", { ascending: true }),
    supabase.from("linkitos_items").select("id,category_id,title,url,image_url,price,notes,favorite,created_at").order("created_at", { ascending: false }),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (itemResult.error) throw itemResult.error;
  cloudCategoryRows = categoryResult.data || [];
  if (!cloudCategoryRows.length) {
    const savedCategories = localSavedData?.categories?.length ? localSavedData.categories : starterData.categories;
    const inserted = await supabase.from("linkitos_categories").insert(savedCategories.map((name) => ({ name }))).select("id,name,created_at");
    if (inserted.error) throw inserted.error;
    cloudCategoryRows = inserted.data || [];
  }
  let rows = itemResult.data || [];
  const localItems = (localSavedData?.items || []).filter((item) => !String(item.id).startsWith("sample-"));
  const importKey = `${STORAGE_KEY}-cloud-imported`;
  if (localItems.length && !localStorage.getItem(importKey)) {
    setSyncStatus("syncing", "Importando tus links");
    const existingUrls = new Set(rows.map((item) => item.url));
    const localCategoryNames = [...new Set(localItems.map((item) => item.category))];
    const missingNames = localCategoryNames.filter((name) => !cloudCategoryRows.some((entry) => entry.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es")));
    if (missingNames.length) {
      const insertedCategories = await supabase.from("linkitos_categories").insert(missingNames.map((name) => ({ name }))).select("id,name,created_at");
      if (insertedCategories.error) throw insertedCategories.error;
      cloudCategoryRows = [...cloudCategoryRows, ...(insertedCategories.data || [])];
    }
    const imports = localItems.filter((item) => !existingUrls.has(item.url)).map((item) => ({
      category_id: categoryIdFor(item.category) || cloudCategoryRows[0]?.id,
      title: item.title, url: item.url, image_url: item.image || null, price: Number(item.price) || null,
      notes: item.notes || null, favorite: Boolean(item.favorite), created_at: new Date(item.createdAt || Date.now()).toISOString(),
    })).filter((item) => item.category_id);
    if (imports.length) {
      const imported = await supabase.from("linkitos_items").insert(imports).select("id,category_id,title,url,image_url,price,notes,favorite,created_at");
      if (imported.error) throw imported.error;
      rows = [...(imported.data || []), ...rows];
    }
    localStorage.setItem(importKey, "yes");
  }
  data = { categories: cloudCategoryRows.map((entry) => entry.name), items: rows.map(mapCloudItem) };
  persist();
  setSyncStatus("synced");
  render();
}
function watchCloudChanges() {
  if (liveChannel) supabase.removeChannel(liveChannel);
  let refreshTimer;
  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (cloudMode) loadCloudData().catch(() => setSyncStatus("offline"));
    }, 250);
  };
  liveChannel = supabase.channel(`linkitos-${currentUser.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "linkitos_categories", filter: `user_id=eq.${currentUser.id}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "linkitos_items", filter: `user_id=eq.${currentUser.id}` }, refresh)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("synced");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncStatus("offline");
    });
}
async function connectUser(user) {
  currentUser = user;
  cloudMode = Boolean(user);
  if (!user) { showAuth(); return; }
  setProfile(user);
  hideAuth();
  try { await loadCloudData(); watchCloudChanges(); }
  catch (error) {
    cloudMode = false;
    data = localSavedData || structuredClone(starterData);
    render();
    setSyncStatus("offline");
    showToast(error.message || "No se pudo cargar tu colección");
  }
  if ($("#auth-screen").dataset.pendingShare === "true") {
    $("#auth-screen").dataset.pendingShare = "false";
    itemModal.showModal();
  }
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function iconFor(category) { return categoryMeta[category] || "✦"; }
function currency(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(amount) : "";
}
function domainFor(link) {
  try { return new URL(link).hostname.replace(/^www\./, ""); }
  catch { return "Enlace guardado"; }
}
function relativeDate(date) {
  const days = Math.floor((Date.now() - Number(date)) / 86400000);
  if (days < 1) return "Hoy";
  if (days === 1) return "Ayer";
  return `Hace ${days} días`;
}
function selectedItems() {
  let list = [...data.items];
  if (currentFilter === "favorites") list = list.filter((item) => item.favorite);
  else if (currentFilter !== "all") list = list.filter((item) => item.category === currentFilter);
  const query = $("#search").value.trim().toLocaleLowerCase("es");
  if (query) list = list.filter((item) => `${item.title} ${item.category} ${item.notes || ""} ${domainFor(item.url)}`.toLocaleLowerCase("es").includes(query));
  if (sortMode === "price") list.sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity));
  else list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}
function renderCategories() {
  const categoryCounts = Object.fromEntries(data.categories.map((category) => [category, data.items.filter((item) => item.category === category).length]));
  categoryList.innerHTML = data.categories.map((category) => `<button class="category-link ${currentFilter === category ? "selected" : ""}" data-filter="${escapeHtml(category)}"><span class="category-emoji">${iconFor(category)}</span><span>${escapeHtml(category)}</span><span class="category-number">${categoryCounts[category] || 0}</span></button>`).join("");
  $("#all-count").textContent = data.items.length;
  $("#summary-total").textContent = data.items.length;
  $("#summary-categories").textContent = data.categories.length;
  const select = $("#item-category");
  const prior = select.value;
  select.innerHTML = data.categories.map((category) => `<option value="${escapeHtml(category)}">${iconFor(category)} &nbsp; ${escapeHtml(category)}</option>`).join("");
  if (data.categories.includes(prior)) select.value = prior;
}
function renderFilters() {
  const filters = [{ id: "all", label: "Todo" }, { id: "favorites", label: "♡ Favoritos" }, ...data.categories.map((category) => ({ id: category, label: `${iconFor(category)} ${category}` }))];
  $("#filter-pills").innerHTML = filters.map(({ id, label }) => `<button class="filter-pill ${currentFilter === id ? "active" : ""}" data-filter="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join("");
}
function renderHeader() {
  const title = currentFilter === "all" ? "Todos mis links" : currentFilter === "favorites" ? "Favoritos" : currentFilter;
  $("#crumb-label").textContent = title;
  if (currentFilter === "all") {
    $("#page-title").innerHTML = "Cosas que me gustan<span class=\"title-star\">✳</span>";
    $("#page-subtitle").textContent = "Guarda aquí tus próximos favoritos. Todo lo que encuentras, en un solo lugar.";
    $("#section-title").innerHTML = `Tus últimos hallazgos <span class="soft-count" id="visible-count">${selectedItems().length}</span>`;
  } else if (currentFilter === "favorites") {
    $("#page-title").innerHTML = "Mis favoritos<span class=\"title-star\">♡</span>";
    $("#page-subtitle").textContent = "Esas cosas que te gustan un poquito más.";
    $("#section-title").innerHTML = `Guardados con cariño <span class="soft-count" id="visible-count">${selectedItems().length}</span>`;
  } else {
    $("#page-title").innerHTML = `${escapeHtml(currentFilter)}<span class="title-star">${iconFor(currentFilter)}</span>`;
    $("#page-subtitle").textContent = `Tus hallazgos favoritos en ${currentFilter.toLocaleLowerCase("es")}.`;
    $("#section-title").innerHTML = `En ${escapeHtml(currentFilter)} <span class="soft-count" id="visible-count">${selectedItems().length}</span>`;
  }
}
function renderItems() {
  const items = selectedItems();
  const empty = data.items.length === 0;
  $("#empty-state").hidden = !empty;
  $("#no-results").hidden = empty || items.length > 0;
  itemGrid.hidden = empty || items.length === 0;
  $("#visible-count").textContent = items.length;
  if (empty || !items.length) itemGrid.innerHTML = "";
  else itemGrid.innerHTML = items.map((item, index) => `
    <article class="item-card" style="animation-delay:${Math.min(index * 55, 275)}ms">
      <div class="item-photo ${item.image ? "" : "no-image"}">${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('no-image');this.remove()" />` : `<span class="photo-placeholder">${iconFor(item.category)}</span>`}<div class="photo-wash"></div><span class="card-category">${iconFor(item.category)} &nbsp;${escapeHtml(item.category)}</span><button class="favorite-button ${item.favorite ? "is-favorite" : ""}" data-favorite="${escapeHtml(item.id)}" aria-label="${item.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}">${item.favorite ? "♥" : "♡"}</button></div>
      <div class="item-details"><div class="item-title-row"><h3 class="item-title">${escapeHtml(item.title)}</h3>${currency(item.price) ? `<span class="item-price">${currency(item.price)}</span>` : ""}</div><div class="item-domain">${escapeHtml(domainFor(item.url))}</div>${item.notes ? `<div class="item-note">${escapeHtml(item.notes)}</div>` : ""}<div class="item-bottom"><span class="item-date">${relativeDate(item.createdAt)}</span><div class="card-actions"><button class="delete-link" data-delete="${escapeHtml(item.id)}" aria-label="Eliminar ${escapeHtml(item.title)}" title="Eliminar">×</button><a class="card-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ver producto ↗</a></div></div></div>
    </article>`).join("");
}
function render() { renderCategories(); renderFilters(); renderHeader(); renderItems(); }
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}
function openCategoryModal() { categoryModal.showModal(); setTimeout(() => $("#category-name").focus(), 80); }
function closeOnBackdrop(dialog) { dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }); }

document.addEventListener("click", async (event) => {
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    currentFilter = filterButton.dataset.filter;
    document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.filter === currentFilter));
    render(); $("#sidebar").classList.remove("open");
  }
  const favoriteButton = event.target.closest("[data-favorite]");
  if (favoriteButton) {
    const item = data.items.find((entry) => entry.id === favoriteButton.dataset.favorite);
    if (item) {
      const nextFavorite = !item.favorite;
      if (cloudMode) {
        setSyncStatus("syncing");
        const result = await supabase.from("linkitos_items").update({ favorite: nextFavorite, updated_at: new Date().toISOString() }).eq("id", item.id);
        if (result.error) { setSyncStatus("offline"); showToast("No se pudo actualizar el favorito"); return; }
      }
      item.favorite = nextFavorite; persist(); render(); setSyncStatus("synced");
    }
  }
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    if (cloudMode) {
      setSyncStatus("syncing");
      const result = await supabase.from("linkitos_items").delete().eq("id", deleteButton.dataset.delete);
      if (result.error) { setSyncStatus("offline"); showToast("No se pudo eliminar el link"); return; }
    }
    data.items = data.items.filter((entry) => entry.id !== deleteButton.dataset.delete);
    persist(); render(); setSyncStatus("synced"); showToast("Link eliminado de tu colección");
  }
});
$("#open-add").addEventListener("click", () => { itemModal.showModal(); setTimeout(() => $("#item-url").focus(), 80); });
$("#empty-add").addEventListener("click", () => { itemModal.showModal(); setTimeout(() => $("#item-url").focus(), 80); });
$("#preview-link").addEventListener("click", async () => {
  const url = $("#item-url").value.trim();
  if (!url) { showToast("Pega primero el enlace del producto"); return; }
  if (!cloudMode || !supabase) { showToast("Inicia sesión para completar los datos del enlace"); return; }
  const button = $("#preview-link");
  const hint = $("#preview-hint");
  button.disabled = true; button.textContent = "Buscando los datos…"; hint.textContent = "La tienda puede tardar unos segundos.";
  try {
    const { data: preview, error } = await supabase.functions.invoke("product-preview", { body: { url } });
    if (error) {
      let message = error.message;
      try { message = (await error.context.json()).error || message; } catch { /* Use the SDK message. */ }
      throw new Error(message);
    }
    if (preview.title && !$("#item-form").elements.title.value) $("#item-form").elements.title.value = preview.title;
    if (preview.image && !$("#item-form").elements.image.value) $("#item-form").elements.image.value = preview.image;
    if (preview.price !== undefined && $("#item-form").elements.price.value === "") $("#item-form").elements.price.value = preview.price;
    hint.textContent = "Datos encontrados. Revísalos antes de guardar, especialmente el precio.";
    showToast("Hemos completado los datos disponibles");
  } catch (error) {
    hint.textContent = error.message || "No se pudieron leer los datos. Puedes completarlos a mano.";
  } finally { button.disabled = false; button.innerHTML = "✦ &nbsp; Completar datos del enlace"; }
});
$("#add-category").addEventListener("click", openCategoryModal);
$("#add-category-side").addEventListener("click", openCategoryModal);
document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
closeOnBackdrop(itemModal); closeOnBackdrop(categoryModal);
$("#search").addEventListener("input", render);
$("#sort-button").addEventListener("click", () => {
  sortMode = sortMode === "recent" ? "price" : "recent";
  $("#sort-button").innerHTML = `${sortMode === "recent" ? "Más recientes" : "Precio más bajo"} <span>⌄</span>`;
  renderItems();
});
$("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  let url = String(form.get("url")).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { new URL(url); } catch { showToast("Revisa el enlace e inténtalo de nuevo"); return; }
  const image = String(form.get("image") || "").trim();
  const title = String(form.get("title")).trim();
  const category = String(form.get("category"));
  const priceValue = form.get("price");
  const price = priceValue === "" ? null : Number(priceValue);
  const notes = String(form.get("notes") || "").trim();
  let savedItem = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), title, category, price: price ?? "", url, image, notes, favorite: false, createdAt: Date.now() };
  if (cloudMode) {
    const category_id = categoryIdFor(category);
    if (!category_id) { showToast("Elige una categoría válida"); return; }
    setSyncStatus("syncing");
    const result = await supabase.from("linkitos_items").insert({ category_id, title, url, image_url: image || null, price, notes: notes || null }).select("id,category_id,title,url,image_url,price,notes,favorite,created_at").single();
    if (result.error) { setSyncStatus("offline"); showToast(result.error.message || "No se pudo guardar el link"); return; }
    savedItem = mapCloudItem(result.data);
  }
  data.items.unshift(savedItem);
  currentFilter = "all"; sortMode = "recent"; $("#sort-button").innerHTML = "Más recientes <span>⌄</span>";
  persist(); render(); itemModal.close(); event.currentTarget.reset(); setSyncStatus("synced"); showToast("¡Link guardado en tu colección!");
});
$("#category-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = String(new FormData(event.currentTarget).get("name")).trim();
  if (!name) return;
  if (data.categories.some((category) => category.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) { showToast("Esa categoría ya existe"); return; }
  if (cloudMode) {
    setSyncStatus("syncing");
    const result = await supabase.from("linkitos_categories").insert({ name }).select("id,name,created_at").single();
    if (result.error) { setSyncStatus("offline"); showToast(result.error.message || "No se pudo crear la categoría"); return; }
    cloudCategoryRows.push(result.data);
  }
  data.categories.push(name); persist(); currentFilter = name; render(); categoryModal.close(); event.currentTarget.reset(); setSyncStatus("synced"); showToast(`Categoría «${name}» creada`);
});
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#auth-switch").addEventListener("click", () => {
  authMode = authMode === "signIn" ? "signUp" : "signIn";
  const signup = authMode === "signUp";
  $("#auth-title").textContent = signup ? "Crea tu espacio." : "Tus links te esperan.";
  $(".auth-intro").textContent = signup ? "Crea una cuenta y lleva tus hallazgos contigo a todas partes." : "Inicia sesión para sincronizar tus hallazgos entre el móvil y el ordenador.";
  $("#auth-submit").innerHTML = signup ? "Crear mi cuenta <span>↗</span>" : "Iniciar sesión <span>↗</span>";
  $("#auth-switch-label").textContent = signup ? "¿Ya tienes cuenta?" : "¿Aún no tienes cuenta?";
  $("#auth-switch").textContent = signup ? "Iniciar sesión" : "Crear una cuenta";
  $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
  setAuthError("");
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || busy) return;
  setBusy(true); setAuthError("");
  const form = new FormData(event.currentTarget);
  const credentials = { email: String(form.get("email")).trim(), password: String(form.get("password")) };
  try {
    const signupCredentials = { ...credentials, options: { emailRedirectTo: new URL("./", location.href).href } };
    const result = authMode === "signUp" ? await supabase.auth.signUp(signupCredentials) : await supabase.auth.signInWithPassword(credentials);
    if (result.error) throw result.error;
    if (result.data.session) await connectUser(result.data.user);
    else if (authMode === "signUp") setAuthError("Te hemos enviado un correo para confirmar la cuenta. Después podrás iniciar sesión aquí.");
  } catch (error) {
    setAuthError(error.message || "No se pudo iniciar sesión. Revisa los datos e inténtalo de nuevo.");
  } finally { setBusy(false); }
});
$("#sign-out").addEventListener("click", async () => {
  if (!supabase) return;
  if (liveChannel) { await supabase.removeChannel(liveChannel); liveChannel = null; }
  const { error } = await supabase.auth.signOut();
  if (error) { showToast("No se pudo cerrar sesión"); return; }
  currentUser = null; cloudMode = false; data = structuredClone(starterData); setProfile(null); showAuth(); setAuthError("");
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#search").focus(); }
  if (event.key === "Escape") $("#sidebar").classList.remove("open");
});

async function initialize() {
  const shared = new URLSearchParams(location.search);
  let sharedUrl = shared.get("url") || "";
  if (!sharedUrl && shared.get("text")) sharedUrl = shared.get("text").match(/https?:\/\/\S+/i)?.[0] || "";
  try {
    if (!window.LINKITOS_CONFIG?.supabaseUrl || !window.supabaseReady) throw new Error("Falta la configuración de sincronización.");
    supabase = await window.supabaseReady;
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (sessionData.session) await connectUser(sessionData.session.user);
    else { showAuth(); setSyncStatus("synced", "Conecta tu cuenta"); }
  } catch (error) {
    cloudMode = false;
    hideAuth();
    setSyncStatus("offline", "Solo en este dispositivo");
    render();
    showToast("No se pudo conectar a la nube. Puedes seguir en este dispositivo.");
  }
  if (sharedUrl) {
    $("#item-url").value = sharedUrl;
    if (shared.get("title")) $("#item-form").elements.title.value = shared.get("title");
    if (!document.body.classList.contains("auth-gate")) itemModal.showModal();
    else $("#auth-screen").dataset.pendingShare = "true";
    history.replaceState({}, "", location.pathname);
  }
}
initialize();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => setSyncStatus("offline", "Modo web"));
}
