// tema elegido a mano (claro u oscuro); sin elegir, el del móvil. Antes de pintar, para que no parpadee
      (function () {
        try {
          var t = localStorage.getItem("cola3d-tema");
          if (t === "light" || t === "dark") {
            document.documentElement.setAttribute("data-theme", t);
            document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute("content", t === "dark" ? "#0d1013" : "#eceff3"); });
          }
        } catch (e) {}
      })();
