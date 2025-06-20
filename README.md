# pdf-signer-online
Aplicación web para visualizar y firmar PDFs online.

---

## Cómo empezar (para desarrolladores)

Este proyecto fue creado con [Create React App](https://github.com/facebook/create-react-app).

### Scripts disponibles

En el directorio del proyecto, puedes ejecutar:

* **`npm start`**: Inicia la aplicación en modo de desarrollo. Abre [http://localhost:3000](http://localhost:3000) para verla en tu navegador.
* **`npm run build`**: Compila la aplicación para producción en la carpeta `build`. La compilación está minificada y los nombres de archivo incluyen hashes. ¡Tu aplicación está lista para ser desplegada!

### Más información

Puedes aprender más en la [documentación de Create React App](https://facebook.github.io/create-react-app/docs/getting-started) y la [documentación de React](https://reactjs.org/).

---

## Despliegue con GitHub Actions

Este repositorio está configurado para desplegarse automáticamente en GitHub Pages cada vez que se realice un `push` a la rama `main`. Las variables de entorno de Supabase se manejan de forma segura a través de los GitHub Secrets.

### Configuración de Secretos de Supabase

Para que el despliegue funcione, asegúrate de haber configurado los siguientes secretos en tu repositorio de GitHub (en `Settings > Secrets and variables > Actions`):

* `REACT_APP_SUPABASE_URL`
* `REACT_APP_SUPABASE_ANON_KEY`