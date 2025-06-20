const Save = document.getElementById("save");

Save.addEventListener("click", async () => {
  try {
    // Пробуем основной метод с улучшенной обработкой HTML
    await saveWithDOMSerialization(); //Сначала используем этот метод
  } catch (error) {
    console.error("Main method failed:", error);
    try {
      // Пробуем альтернативный метод
      await saveWithBlobAPI();
    } catch (fallbackError) {
      console.error("Fallback failed:", fallbackError);
      // Показываем информативное сообщение
      alert(`Failed to save page. Possible reasons:
1. Page is too complex
2. Restricted by site permissions
3. Extension needs update

Error details: ${fallbackError.message}`);
    }
  }
});

// Основной метод - сериализация DOM с обработкой ресурсов
async function saveWithDOMSerialization() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // Функция для получения заголовка страницы
      const getPageTitle = () => {
        const h1 = document.querySelector("h1");
        if (h1 && h1.textContent.trim()) {
          return h1.textContent
            .trim()
            .replace(/[\/\\:*?"<>|]/g, "")
            .substring(0, 100);
        }
        return "page";
      };

      const title = getPageTitle();

      // Создаем новый документ
      const doc = document.implementation.createHTMLDocument("Page Copy");
      // Клонируем весь HTML текущей страницы
      const clone = document.documentElement.cloneNode(true);

      // Обрабатываем все ресурсы
      const processAttributes = (el, attrs) => {
        attrs.forEach((attr) => {
          if (el[attr]) {
            try {
              if (
                !el[attr].startsWith("data:") &&
                !el[attr].startsWith("blob:")
              ) {
                el[attr] = new URL(el[attr], location.href).href;
              }
            } catch (e) {
              console.warn(`Failed to process ${attr}="${el[attr]}"`, e);
            }
          }
        });
      };

      // Обрабатываем все элементы с внешними ресурсами
      clone.querySelectorAll("*").forEach((el) => {
        processAttributes(el, ["src", "href", "srcset", "data-src"]);

        // Особые случаи
        if (el.tagName === "LINK" && el.rel === "stylesheet") {
          processAttributes(el, ["href"]);
        }
        if (el.tagName === "STYLE") {
          el.textContent = el.textContent.replace(
            /url\((['"]?)([^'")]+)\1\)/g,
            (match, quote, url) => {
              try {
                return `url(${quote}${
                  new URL(url, location.href).href
                }${quote})`;
              } catch {
                return match;
              }
            }
          );
        }
      });

      // Добавляем base для корректных относительных путей
      const base = doc.createElement("base");
      base.href = location.href;
      doc.head.appendChild(base);

      // Переносим клонированное содержимое в новый документ
      doc.documentElement.replaceWith(clone);

      return {
        html: doc.documentElement.outerHTML,
        title: title,
      };
    },
    world: "MAIN",
  });

  if (!result?.[0]?.result) throw new Error("No content captured");

  const { html, title } = result[0].result;
  const formattedHtml = `<!DOCTYPE html>\n${html}`
    .replace(/=\\?\"?(.*?)\"?\\?>/g, '="$1">')
    .replace(/\\"/g, '"');

  const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `${title}_${dateStr}.html`;

  downloadFile(formattedHtml, filename, "text/html;charset=utf-8");
}

async function saveWithBlobAPI() {
  const [tab] = await chrome.tabs.query({ active: true });
  if (!tab) throw new Error("No active tab");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // Та же функция для получения заголовка
      const getPageTitle = () => {
        const h1 = document.querySelector("h1");
        if (h1 && h1.textContent.trim()) {
          return h1.textContent
            .trim()
            .replace(/[\/\\:*?"<>|]/g, "")
            .substring(0, 100);
        }
        return "page";
      };

      const title = getPageTitle();

      return {
        url: location.href,
        html: document.documentElement.outerHTML,
        resources: Array.from(
          document.querySelectorAll('img, link[rel="stylesheet"], script[src]')
        ).map((el) => ({
          url: el.src || el.href,
          tag: el.tagName,
        })),
        title: title,
      };
    },
    world: "MAIN",
  });

  if (!result?.[0]?.result) throw new Error("No content captured");

  const { url, html, resources, title } = result[0].result;
  const warning =
    resources.length > 0
      ? `\n<!-- WARNING: ${
          resources.length
        } external resources not included (${resources
          .slice(0, 3)
          .map((r) => r.url)
          .join(", ")}... -->`
      : "";

  // Формируем имя файла: заголовок + дата
  const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `${title}_${dateStr}.html`;

  downloadFile(
    `<!-- Saved from ${url} at ${new Date().toISOString()} -->${warning}\n${html}`,
    filename,
    "text/html;charset=utf-8"
  );
}

// Улучшенная функция скачивания
function downloadFile(content, filename, mimeType) {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
}
