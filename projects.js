const PROJECT_ASSET_BUCKET = "linkitos-project-assets";
const PROJECT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
let projectSupabase = null;
let projectUser = null;
let projectRows = [];
let projectEntryRows = [];
let activeProjectId = null;
let projectsMode = false;
let projectsChannel = null;
let projectAssetCache = new Map();

const projectsView = document.querySelector("#projects-view");
const projectsNav = document.querySelector("#projects-nav");
const projectModal = document.querySelector("#project-modal");
const projectEntryModal = document.querySelector("#project-entry-modal");
const assignItemModal = document.querySelector("#assign-item-modal");
let pendingProjectItemId = null;

function projectStatus(state, message) {
  const status = document.querySelector("#sync-status");
  if (!status) return;
  status.className = `sync-status ${state === "syncing" ? "syncing" : state === "offline" ? "offline" : ""}`;
  status.lastElementChild.textContent = message || (state === "syncing" ? "Sincronizando" : state === "offline" ? "Sin conexión" : "Sincronizado");
}

function projectSafeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function projectFileExtension(file) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[file.type] || "";
}

function validateProjectImage(file) {
  if (!file) return "";
  if (!projectFileExtension(file)) return "Elige una imagen JPG, PNG, WebP o GIF.";
  if (file.size > PROJECT_IMAGE_MAX_BYTES) return "La imagen debe ocupar menos de 10 MB.";
  return "";
}

async function uploadProjectImage(projectId, file) {
  const validation = validateProjectImage(file);
  if (validation) throw new Error(validation);
  const path = `${projectUser.id}/${projectId}/${crypto.randomUUID()}.${projectFileExtension(file)}`;
  const { error } = await projectSupabase.storage.from(PROJECT_ASSET_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const previewUrl = URL.createObjectURL(file);
  projectAssetCache.set(path, previewUrl);
  return path;
}

async function projectAssetUrl(path) {
  if (!path) return "";
  if (projectAssetCache.has(path)) return projectAssetCache.get(path);
  const { data: blob, error } = await projectSupabase.storage.from(PROJECT_ASSET_BUCKET).download(path);
  if (error) return "";
  const url = URL.createObjectURL(blob);
  projectAssetCache.set(path, url);
  return url;
}

function hydrateProjectAssets(root = projectsView) {
  root.querySelectorAll("[data-project-asset]").forEach(async (element) => {
    const url = await projectAssetUrl(element.dataset.projectAsset);
    if (!url || !element.isConnected) return;
    if (element.tagName === "IMG") element.src = url;
    else element.style.backgroundImage = `url("${url}")`;
  });
}

function clearProjectAssets() {
  projectAssetCache.forEach((url) => URL.revokeObjectURL(url));
  projectAssetCache = new Map();
}

function projectEntryCount(projectId) {
  return projectEntryRows.filter((entry) => entry.project_id === projectId).length;
}

function setProjectsVisibility(visible) {
  projectsMode = visible;
  projectsView.hidden = !visible;
  document.querySelector("#welcome-row").hidden = visible;
  document.querySelector("#summary-strip").hidden = visible;
  document.querySelector("#collection-section").hidden = visible;
  projectsNav.classList.toggle("active", visible);
  document.querySelector("#crumb-label").textContent = visible ? "Proyectos" : document.querySelector("#crumb-label").textContent;
  if (visible) document.querySelectorAll(".nav-link[data-filter]").forEach((button) => button.classList.remove("active"));
}

function renderProjectOverview() {
  document.querySelector("#projects-count").textContent = projectRows.length;
  document.querySelector("#crumb-label").textContent = "Proyectos";
  if (!projectUser) {
    projectsView.innerHTML = `<div class="projects-intro"><div class="section-kicker">IDEAS QUE VAN TOMANDO FORMA</div><h2>Proyectos, a tu manera</h2><p>Inicia sesión para reunir fotos, enlaces e ideas en espacios independientes.</p></div>`;
    return;
  }
  projectsView.innerHTML = `
    <div class="projects-heading"><div><div class="section-kicker">TUS IDEAS, EN UN SOLO LUGAR</div><h2>Mis proyectos <span class="soft-count">${projectRows.length}</span></h2><p>Un espacio propio para cada cambio, plan o ilusión.</p></div><button class="primary-button" id="create-project"><span>＋</span> Nuevo proyecto</button></div>
    ${projectRows.length ? `<div class="project-grid">${projectRows.map((project, index) => `
      <button class="project-card" data-open-project="${escapeHtml(project.id)}" style="animation-delay:${Math.min(index * 55, 275)}ms">
        <span class="project-cover ${project.cover_path ? "has-cover" : ""}" ${project.cover_path ? `data-project-asset="${escapeHtml(project.cover_path)}"` : ""}><span class="project-cover-symbol">✦</span><span class="project-cover-count">${projectEntryCount(project.id)} elementos</span></span>
        <span class="project-card-copy"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.description || "Tu próximo proyecto empieza aquí.")}</span><small>ABRIR PROYECTO <b>↗</b></small></span>
      </button>`).join("")}</div>` : `
      <div class="projects-empty"><div class="project-empty-art"><span>✦</span><i>⌂</i><b>↗</b></div><h3>Tu primer proyecto empieza aquí</h3><p>Guarda la inspiración del dormitorio, una reforma, un viaje o cualquier idea que quieras hacer realidad.</p><button class="primary-button" id="create-first-project">＋ Crear mi primer proyecto</button></div>`}`;
  hydrateProjectAssets();
}

function renderProjectDetail() {
  const project = projectRows.find((entry) => entry.id === activeProjectId);
  if (!project) { activeProjectId = null; renderProjectOverview(); return; }
  document.querySelector("#crumb-label").textContent = project.name;
  const entries = projectEntryRows.filter((entry) => entry.project_id === project.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const kindLabel = { idea: "IDEA", link: "ENLACE", image: "FOTO" };
  projectsView.innerHTML = `
    <div class="project-detail-top"><button class="project-back" id="back-to-projects">← Todos los proyectos</button><button class="primary-button" id="add-project-entry"><span>＋</span> Añadir al proyecto</button></div>
    <section class="project-hero ${project.cover_path ? "with-image" : ""}">
      ${project.cover_path ? `<img class="project-hero-image" data-project-asset="${escapeHtml(project.cover_path)}" alt="" />` : `<div class="project-hero-orb orb-a"></div><div class="project-hero-orb orb-b"></div><span class="project-hero-mark">✦</span>`}
      <div class="project-hero-copy"><div class="section-kicker">PROYECTO PERSONAL</div><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description || "Reúne aquí tus ideas, fotos y enlaces.")}</p><span>${entries.length} ${entries.length === 1 ? "elemento guardado" : "elementos guardados"}</span></div>
      <button class="project-delete" id="delete-project" title="Eliminar proyecto" aria-label="Eliminar proyecto">×</button>
    </section>
    ${entries.length ? `<div class="project-entry-grid">${entries.map((entry, index) => `
      <article class="project-entry-card" style="animation-delay:${Math.min(index * 45, 270)}ms">
        ${entry.image_path || entry.image_url ? `<div class="project-entry-image-wrap"><img ${entry.image_path ? `data-project-asset="${escapeHtml(entry.image_path)}"` : `src="${escapeHtml(projectSafeUrl(entry.image_url))}"`} alt="${escapeHtml(entry.title)}" loading="lazy" /><span>${escapeHtml(entry.category || kindLabel[entry.kind] || "FOTO")}</span></div>` : `<div class="project-entry-type ${entry.kind}"><span>${entry.kind === "link" ? "↗" : "✦"}</span><small>${escapeHtml(entry.category || kindLabel[entry.kind] || "IDEA")}</small></div>`}
        <div class="project-entry-copy"><span class="project-entry-kind">${kindLabel[entry.kind] || "IDEA"}${entry.category ? ` · ${escapeHtml(entry.category)}` : ""}</span><h3>${escapeHtml(entry.title)}</h3>${entry.price ? `<strong class="project-entry-price">${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(entry.price)}</strong>` : ""}${entry.body ? `<p>${escapeHtml(entry.body)}</p>` : ""}${entry.url ? `<a class="project-entry-link" href="${escapeHtml(projectSafeUrl(entry.url))}" target="_blank" rel="noopener noreferrer">Abrir enlace ↗</a>` : ""}<button class="project-entry-delete" data-delete-project-entry="${escapeHtml(entry.id)}" aria-label="Eliminar ${escapeHtml(entry.title)}" title="Eliminar">×</button></div>
      </article>`).join("")}</div>` : `<div class="project-detail-empty"><div class="project-empty-art"><span>✦</span><i>⌂</i><b>↗</b></div><h3>Guarda aquí tu inspiración</h3><p>Añade una primera idea, una foto de referencia o un enlace que quieras tener a mano.</p><button class="primary-button" id="add-first-project-entry">＋ Añadir al proyecto</button></div>`}`;
  hydrateProjectAssets();
}

function renderProjects() {
  if (!projectsMode) return;
  if (activeProjectId) renderProjectDetail();
  else renderProjectOverview();
}

async function loadProjects() {
  if (!projectSupabase || !projectUser) return;
  projectStatus("syncing", "Sincronizando proyectos");
  const [projectResult, entryResult] = await Promise.all([
    projectSupabase.from("linkitos_projects").select("id,name,description,cover_path,created_at,updated_at").order("updated_at", { ascending: false }),
    projectSupabase.from("linkitos_project_entries").select("id,project_id,kind,title,body,url,image_url,price,category,image_path,created_at,updated_at").order("created_at", { ascending: false }),
  ]);
  if (projectResult.error) throw projectResult.error;
  if (entryResult.error) throw entryResult.error;
  projectRows = projectResult.data || [];
  projectEntryRows = entryResult.data || [];
  document.querySelector("#projects-count").textContent = projectRows.length;
  renderProjects();
  projectStatus("synced");
}

function watchProjectChanges() {
  if (projectsChannel) projectSupabase.removeChannel(projectsChannel);
  let refreshTimer;
  const refresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadProjects().catch(() => projectStatus("offline")), 300);
  };
  projectsChannel = projectSupabase.channel(`linkitos-projects-${projectUser.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "linkitos_projects", filter: `user_id=eq.${projectUser.id}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "linkitos_project_entries", filter: `user_id=eq.${projectUser.id}` }, refresh)
    .subscribe();
}

function openProjects() {
  activeProjectId = null;
  setProjectsVisibility(true);
  renderProjectOverview();
  document.querySelector("#sidebar").classList.remove("open");
  if (!projectUser) showToast("Inicia sesión para guardar proyectos en la nube");
}

function showProject(projectId) {
  activeProjectId = projectId;
  renderProjectDetail();
  document.querySelector("#sidebar").classList.remove("open");
}

function openProjectModal() {
  if (!projectUser) { showToast("Inicia sesión para crear un proyecto"); return; }
  document.querySelector("#project-form").reset();
  projectModal.showModal();
}

function openProjectEntryModal() {
  if (!projectUser || !activeProjectId) return;
  document.querySelector("#project-entry-form").reset();
  syncProjectEntryFields();
  projectEntryModal.showModal();
}

function syncProjectEntryFields() {
  const kind = document.querySelector("#project-entry-kind").value;
  document.querySelector("#project-entry-url-field").hidden = kind !== "link";
  document.querySelector("#project-entry-image-field").hidden = kind !== "image";
  const url = document.querySelector("#project-entry-url");
  const image = document.querySelector("#project-entry-image");
  url.required = kind === "link";
  image.required = kind === "image";
  document.querySelector("#project-entry-body").placeholder = kind === "idea" ? "Colores, medidas, materiales o cualquier detalle…" : "Añade contexto o detalles (opcional)…";
}

async function removeProjectAsset(path) {
  if (!path) return;
  const { error } = await projectSupabase.storage.from(PROJECT_ASSET_BUCKET).remove([path]);
  if (error) throw error;
  const url = projectAssetCache.get(path);
  if (url) URL.revokeObjectURL(url);
  projectAssetCache.delete(path);
}

projectsNav.addEventListener("click", openProjects);
document.querySelectorAll(".nav-link[data-filter]").forEach((button) => button.addEventListener("click", () => setProjectsVisibility(false)));
document.querySelector("#project-entry-kind").addEventListener("change", syncProjectEntryFields);
document.querySelectorAll("#project-modal, #project-entry-modal").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));

projectsView.addEventListener("click", async (event) => {
  if (event.target.closest("#create-project, #create-first-project")) { openProjectModal(); return; }
  if (event.target.closest("#add-project-entry, #add-first-project-entry")) { openProjectEntryModal(); return; }
  if (event.target.closest("#back-to-projects")) { activeProjectId = null; renderProjectOverview(); return; }
  const openButton = event.target.closest("[data-open-project]");
  if (openButton) { showProject(openButton.dataset.openProject); return; }
  const deleteEntryButton = event.target.closest("[data-delete-project-entry]");
  if (deleteEntryButton) {
    const entry = projectEntryRows.find((row) => row.id === deleteEntryButton.dataset.deleteProjectEntry);
    if (!entry || !window.confirm(`¿Eliminar «${entry.title}» de este proyecto?`)) return;
    try {
      projectStatus("syncing");
      if (entry.image_path) await removeProjectAsset(entry.image_path);
      const { error } = await projectSupabase.from("linkitos_project_entries").delete().eq("id", entry.id);
      if (error) throw error;
      await loadProjects();
      showToast("Elemento eliminado del proyecto");
    } catch (error) { projectStatus("offline"); showToast(error.message || "No se pudo eliminar el elemento"); }
    return;
  }
  if (event.target.closest("#delete-project")) {
    const project = projectRows.find((row) => row.id === activeProjectId);
    if (!project || !window.confirm(`¿Eliminar el proyecto «${project.name}» y todo su contenido?`)) return;
    try {
      projectStatus("syncing");
      const paths = [project.cover_path, ...projectEntryRows.filter((row) => row.project_id === project.id).map((row) => row.image_path)].filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await projectSupabase.storage.from(PROJECT_ASSET_BUCKET).remove(paths);
        if (storageError) throw storageError;
        paths.forEach((path) => { const url = projectAssetCache.get(path); if (url) URL.revokeObjectURL(url); projectAssetCache.delete(path); });
      }
      const { error } = await projectSupabase.from("linkitos_projects").delete().eq("id", project.id);
      if (error) throw error;
      activeProjectId = null;
      await loadProjects();
      showToast("Proyecto eliminado");
    } catch (error) { projectStatus("offline"); showToast(error.message || "No se pudo eliminar el proyecto"); }
  }
});

function openAssignItemToProject(itemId) {
  const item = data.items.find((entry) => entry.id === itemId);
  if (!item) return;
  if (!projectUser) { showToast("Inicia sesión para añadir links a un proyecto"); return; }
  if (!projectRows.length) {
    showToast("Crea primero un proyecto para guardar este link");
    openProjects();
    openProjectModal();
    return;
  }
  pendingProjectItemId = itemId;
  document.querySelector("#assign-item-title").textContent = `«${item.title}» se añadirá con su foto, precio y notas.`;
  document.querySelector("#assign-item-project").innerHTML = projectRows.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join("");
  assignItemModal.showModal();
}

document.querySelector("#item-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-item-to-project]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  openAssignItemToProject(button.dataset.addItemToProject);
});

document.querySelector("#assign-item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = data.items.find((entry) => entry.id === pendingProjectItemId);
  const projectId = document.querySelector("#assign-item-project").value;
  if (!item || !projectId) return;
  try {
    projectStatus("syncing");
    const { error } = await projectSupabase.from("linkitos_project_entries").insert({
      project_id: projectId,
      kind: "link",
      title: item.title,
      body: item.notes || null,
      url: item.url,
      image_url: item.image || null,
      price: Number(item.price) > 0 ? Number(item.price) : null,
      category: item.category || null,
    });
    if (error) throw error;
    const { error: updateError } = await projectSupabase.from("linkitos_projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId);
    if (updateError) throw updateError;
    assignItemModal.close();
    pendingProjectItemId = null;
    await loadProjects();
    showToast("Link añadido al proyecto con sus detalles");
  } catch (error) { projectStatus("offline"); showToast(error.message || "No se pudo añadir el link al proyecto"); }
});

document.querySelector("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const description = String(form.get("description") || "").trim();
  const cover = form.get("cover");
  if (cover?.size) { const validation = validateProjectImage(cover); if (validation) { showToast(validation); return; } }
  const projectId = crypto.randomUUID();
  try {
    projectStatus("syncing");
    const { data: project, error } = await projectSupabase.from("linkitos_projects").insert({ id: projectId, name, description: description || null }).select("id,name,description,cover_path,created_at,updated_at").single();
    if (error) throw error;
    let savedProject = project;
    if (cover?.size) {
      const coverPath = await uploadProjectImage(project.id, cover);
      const { data: updated, error: updateError } = await projectSupabase.from("linkitos_projects").update({ cover_path: coverPath, updated_at: new Date().toISOString() }).eq("id", project.id).select("id,name,description,cover_path,created_at,updated_at").single();
      if (updateError) throw updateError;
      savedProject = updated;
    }
    projectRows = [savedProject, ...projectRows.filter((row) => row.id !== project.id)];
    activeProjectId = project.id;
    projectModal.close();
    event.currentTarget.reset();
    renderProjectDetail();
    projectStatus("synced");
    showToast("Proyecto creado");
  } catch (error) { projectStatus("offline"); showToast(error.message || "No se pudo crear el proyecto"); }
});

document.querySelector("#project-entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const kind = String(form.get("kind"));
  const title = String(form.get("title") || "").trim();
  const body = String(form.get("body") || "").trim();
  const url = String(form.get("url") || "").trim();
  const image = form.get("image");
  const safeUrl = kind === "link" ? projectSafeUrl(url) : "";
  if (kind === "link" && !safeUrl) { showToast("Introduce un enlace que empiece por http:// o https://"); return; }
  if (kind === "image" && !image?.size) { showToast("Elige una foto para añadirla al proyecto"); return; }
  if (image?.size) { const validation = validateProjectImage(image); if (validation) { showToast(validation); return; } }
  try {
    projectStatus("syncing");
    const entryId = crypto.randomUUID();
    const entryImagePath = image?.size ? await uploadProjectImage(activeProjectId, image) : null;
    const { data: entry, error } = await projectSupabase.from("linkitos_project_entries").insert({
      id: entryId, project_id: activeProjectId, kind, title, body: body || null, url: safeUrl || null, image_path: entryImagePath,
    }).select("id,project_id,kind,title,body,url,image_url,price,category,image_path,created_at,updated_at").single();
    if (error) {
      if (entryImagePath) await removeProjectAsset(entryImagePath).catch(() => {});
      throw error;
    }
    projectEntryRows = [entry, ...projectEntryRows.filter((row) => row.id !== entry.id)];
    const project = projectRows.find((row) => row.id === activeProjectId);
    if (project) {
      const { error: updateError } = await projectSupabase.from("linkitos_projects").update({ updated_at: new Date().toISOString() }).eq("id", project.id);
      if (updateError) throw updateError;
    }
    projectEntryModal.close();
    event.currentTarget.reset();
    renderProjectDetail();
    projectStatus("synced");
    showToast("Guardado en el proyecto");
  } catch (error) { projectStatus("offline"); showToast(error.message || "No se pudo guardar en el proyecto"); }
});

window.supabaseReady.then(async (client) => {
  projectSupabase = client;
  const { data: { session } } = await client.auth.getSession();
  projectUser = session?.user || null;
  if (projectUser) {
    try { await loadProjects(); watchProjectChanges(); }
    catch (error) { projectStatus("offline"); }
  }
  client.auth.onAuthStateChange((event, nextSession) => {
    if (!["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT"].includes(event)) return;
    const nextUser = nextSession?.user || null;
    if (nextUser?.id === projectUser?.id) return;
    projectUser = nextUser;
    if (projectsChannel) { client.removeChannel(projectsChannel); projectsChannel = null; }
    clearProjectAssets();
    projectRows = [];
    projectEntryRows = [];
    activeProjectId = null;
    if (!nextUser) {
      document.querySelector("#projects-count").textContent = "0";
      if (projectsMode) renderProjectOverview();
      return;
    }
    setTimeout(() => loadProjects().then(watchProjectChanges).catch((error) => { projectStatus("offline"); showToast(error.message || "No se pudieron cargar los proyectos"); }), 0);
  });
}).catch(() => { projectStatus("offline"); });
