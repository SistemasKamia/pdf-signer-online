import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import SignatureCanvas from 'react-signature-canvas';
import { PDFDocument } from 'pdf-lib';
import { decode as arrayBufferDecode, encode as arrayBufferEncode } from 'base64-arraybuffer';

// Importar Supabase Client
import { createClient } from '@supabase/supabase-js';

// *********************************************************************************
// ¡SOLUCIÓN FINAL Y MÁS ROBUSTA PARA EL WORKER CON LA VERSIÓN ESPECÍFICA DETECTADA EN CONSOLA!
// Apuntamos a la versión 3.11.174 de pdf.worker.min.js en CDNJS.
// *********************************************************************************
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// Inicializar Supabase Client
// Asegúrate de que estas variables de entorno estén definidas en tu archivo .env
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Verificar que las claves de Supabase existan para evitar errores de inicialización
if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Faltan las variables de entorno de Supabase. Asegúrate de configurar REACT_APP_SUPABASE_URL y REACT_APP_SUPABASE_ANON_KEY en tu archivo .env");
    // Si las claves no están, las llamadas a Supabase fallarán. Se puede añadir un mensaje de error más visible.
}
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Función para generar un ID único para el proceso (usado para la URL y Supabase)
const generateUniqueId = () => Math.random().toString(36).substr(2, 9); // Renombrada para uso general

function App() {
    // --- Estados de la aplicación ---
    const [selectedFile, setSelectedFile] = useState(null);
    const [pdfOriginalBuffer, setPdfOriginalBuffer] = useState(null); // PDF en Base64 para manipulación

    const [fileUrl, setFileUrl] = useState(null); // URL Blob para react-pdf
    const [errorMessage, setErrorMessage] = useState('');
    const [numPages, setNumPages] = useState(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.0);

    const viewerRef = useRef(null); // Referencia al contenedor del visor de PDF

    // Estados para el arrastre del PDF en el visor
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [startY, setStartY] = useState(0);
    const [scrollLeftInitial, setScrollLeftInitial] = useState(0);
    const [scrollTopInitial, setScrollTopInitial] = useState(0);

    // Estados para el Recuadro 1 (posicionamiento y redimensionamiento de la firma)
    const [showSignatureBox1, setShowSignatureBox1] = useState(false);
    const [signatureBox1Pos, setSignatureBox1Pos] = useState({ x: 0, y: 0 });
    const [signatureBox1Size, setSignatureBox1Size] = useState({ width: 200, height: 100 });

    // Estados para arrastre y redimensionamiento del recuadro de firma
    const [isDraggingBox, setIsDraggingBox] = useState(false);
    const [boxDragOffsetX, setBoxDragOffsetX] = useState(0);
    const [boxDragOffsetY, setBoxDragOffsetY] = useState(0);

    const [isResizingBox, setIsResizingBox] = useState(false);
    const [resizeHandleType, setResizeHandleType] = useState(null); // 'br' (bottom-right), 'bl' (bottom-left)
    const [initialBoxRect, setInitialBoxRect] = useState(null); // Posición y tamaño inicial del recuadro al empezar a arrastrar/redimensionar
    const [initialMousePos, setInitialMousePos] = useState(null); // Posición inicial del ratón al empezar a arrastrar/redimensionar

    // Estados para el Recuadro 2 (confirmación del área de la firma)
    const [showSignatureBox2, setShowSignatureBox2] = useState(false);
    const [finalSignaturePos, setFinalSignaturePos] = useState({ x: 0, y: 0 }); // Posición final confirmada
    const [finalSignatureSize, setFinalSignatureSize] = useState({ width: 0, height: 0 }); // Tamaño final confirmado

    // Estados para el Recuadro 3 (modal de dibujo de la firma)
    const [showSignatureBox3, setShowSignatureBox3] = useState(false);
    const sigCanvasRef = useRef(null); // Referencia al componente SignatureCanvas
    const modalCanvasDrawingAreaRef = useRef(null); // Referencia al div que contiene el canvas del modal
    const [sigCanvasWidth, setSigCanvasWidth] = useState(0);
    const [sigCanvasHeight, setSigCanvasHeight] = useState(0);
    const pdfDocProxyRef = useRef(null); // Referencia al objeto de documento PDF cargado por react-pdf

    // Nuevos estados para funcionalidades avanzadas
    const [hasSignatureApplied, setHasSignatureApplied] = useState(false); // Indica si ya se incrustó al menos una firma
    const [showHelpModal, setShowHelpModal] = useState(false); // Controla la visibilidad del modal de ayuda
    const [processId, setProcessId] = useState(null); // ID único para el proceso actual (para URL y Supabase)
    const [userId, setUserId] = useState(null); // ID del usuario (generado localmente)


    // EFECTO 1: Generación de userId local al inicio (REEMPLAZA AUTENTICACIÓN DE FIREBASE)
    useEffect(() => {
        // Intentar cargar userId de sessionStorage o generar uno nuevo
        let currentUserId = sessionStorage.getItem('app_user_id');
        if (!currentUserId) {
            currentUserId = generateUniqueId();
            sessionStorage.setItem('app_user_id', currentUserId); // Guarda en sessionStorage para persistir entre recargas
        }
        setUserId(currentUserId);
        console.log("UserID de sesión:", currentUserId);
    }, []); // Se ejecuta solo una vez al montar la aplicación


    // EFECTO 2: Carga inicial de la aplicación y gestión del processId en URL
    useEffect(() => {
        if (!userId) return; // Asegurarse de que userId ya se haya establecido

        const loadInitialProcess = async () => {
            const hash = window.location.hash; // Obtener la parte del hash de la URL (ej. "#proceso=XYZ")
            const params = new URLSearchParams(hash.substring(1)); // Crear un objeto URLSearchParams, eliminando el '#'
            const idFromUrl = params.get('proceso'); // Obtener el valor del parámetro 'proceso'

            if (idFromUrl) {
                setProcessId(idFromUrl); // Establecer el ID de proceso obtenido de la URL
                try {
                    // Intentar cargar el estado guardado desde Supabase usando el ID de la URL
                    const { data, error } = await supabase
                        .from('process_states')
                        .select('state_data') // Solo necesitamos la columna 'state_data'
                        .eq('id', idFromUrl) // Buscar por el ID de proceso
                        .eq('user_id', userId) // CRUCIAL: Solo cargar si el user_id coincide (por RLS)
                        .single(); // Esperar un solo resultado

                    if (error && error.code !== 'PGRST116') { // 'PGRST116' es el código para "no row found"
                        throw error; // Lanzar otros errores que no sean "no encontrado"
                    }

                    if (data && data.state_data) {
                        // Si se encuentra el estado guardado, restaurar todos los estados de la aplicación
                        const parsedState = data.state_data;

                        // Decodificar el buffer del PDF (que está en Base64) y crear una URL Blob para el visor
                        const buffer = arrayBufferDecode(parsedState.pdfOriginalBuffer);
                        setPdfOriginalBuffer(parsedState.pdfOriginalBuffer);
                        const newFileBlob = new Blob([buffer], { type: 'application/pdf' });
                        setSelectedFile(newFileBlob);

                        // Si ya existe una URL de archivo anterior, revocarla para liberar memoria
                        if (fileUrl) URL.revokeObjectURL(fileUrl);
                        setFileUrl(URL.createObjectURL(newFileBlob));

                        // Restaurar el resto de estados guardados
                        setNumPages(parsedState.numPages);
                        setPageNumber(parsedState.pageNumber);
                        setScale(parsedState.scale);
                        setHasSignatureApplied(parsedState.hasSignatureApplied);
                        setShowSignatureBox1(parsedState.showSignatureBox1);
                        setSignatureBox1Pos(parsedState.signatureBox1Pos);
                        setSignatureBox1Size(parsedState.signatureBox1Size);
                        setShowSignatureBox2(parsedState.showSignatureBox2);
                        setFinalSignaturePos(parsedState.finalSignaturePos);
                        setFinalSignatureSize(parsedState.finalSignatureSize);
                        setShowSignatureBox3(parsedState.showSignatureBox3); // Debería ser false si se guardó desde Recuadro 3

                        setErrorMessage('Proceso cargado desde URL exitosamente.');
                        setTimeout(() => setErrorMessage(''), 3000); // Limpiar mensaje después de 3 segundos
                    } else {
                        // Si el ID estaba en la URL pero no se encontró un estado guardado en Supabase,
                        // significa que el enlace puede ser viejo o inválido, o no pertenece a este usuario.
                        console.warn('ID en URL pero no hay proceso guardado en Supabase para este ID o no es tuyo. Iniciando un nuevo proceso.');
                        const newId = generateUniqueId(); // Generar un nuevo ID único
                        setProcessId(newId); // Establecer el nuevo ID
                        window.location.hash = `proceso=${newId}`; // Actualizar la URL con el nuevo ID
                        setErrorMessage('Proceso no encontrado o no autorizado. Iniciando uno nuevo.');
                        setTimeout(() => setErrorMessage(''), 5000); // Limpiar mensaje
                        // Los estados de la aplicación se mantendrán en sus valores iniciales (limpios) por defecto.
                    }
                } catch (e) {
                    // Capturar errores durante la carga (problemas de red, datos corruptos, etc.)
                    console.error('Error al cargar proceso desde URL (posiblemente ID corrupto o problema de red/Supabase):', e);
                    setErrorMessage('Error al cargar proceso. Se iniciará uno nuevo.');
                    setTimeout(() => setErrorMessage(''), 5000); // Limpiar mensaje
                    const newId = generateUniqueId(); // Generar un nuevo ID para el nuevo proceso
                    setProcessId(newId);
                    window.location.hash = `proceso=${newId}`; // Actualizar la URL
                }
            } else {
                // Si no hay ningún ID en la URL al inicio, generar uno nuevo y establecerlo.
                const newId = generateUniqueId();
                setProcessId(newId);
                window.location.hash = `proceso=${newId}`; // Esto actualizará la URL en el navegador
            }
        };

        loadInitialProcess();

        // Función de limpieza para revocar la URL Blob si el componente se desmonta o fileUrl cambia
        // Esto es importante para liberar memoria.
        return () => {
            if (fileUrl) {
                URL.revokeObjectURL(fileUrl);
            }
        };
    }, [userId]); // Este efecto se ejecuta cuando userId está disponible.


    // Efecto para liberar la URL del archivo al desmontar el componente (redundante con el de arriba, pero seguro)
    useEffect(() => {
        return () => {
            if (fileUrl) {
                URL.revokeObjectURL(fileUrl);
            }
        };
    }, [fileUrl]);


    // Efecto para el posicionamiento inicial del recuadro de firma (Recuadro 1)
    // Se recalcula al mostrar la caja o si cambian las dimensiones del PDF/visor.
    useEffect(() => {
        if (!showSignatureBox1 || !viewerRef.current || !selectedFile || !pdfDocProxyRef.current) return;

        const handleInitialBoxPosition = async () => {
            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement || pdfPageElement.getBoundingClientRect().width === 0 || pdfPageElement.getBoundingClientRect().height === 0) {
                console.warn('PDF Page element not found or has zero dimensions. Retrying position calculation for signature box...');
                setTimeout(handleInitialBoxPosition, 200); // Reintentar si la página no tiene dimensiones aún
                return;
            }

            const pdfPageRect = pdfPageElement.getBoundingClientRect(); // Dimensiones del canvas renderizado en pantalla
            const viewerRect = viewerRef.current.getBoundingClientRect(); // Dimensiones del contenedor del visor

            // Calcular el scroll actual del visor para posicionar el recuadro correctamente
            const scrollX = viewerRef.current.scrollLeft;
            const scrollY = viewerRef.current.scrollTop;

            // Calcular la posición absoluta de la página PDF *dentro del área scrollable* del visor
            // Esta es la posición X/Y del borde superior izquierdo de la página PDF relativa al inicio del área scrollable.
            const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
            const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;

            // Ajustar el ancho y alto deseado del recuadro si es necesario,
            // por ejemplo, para que no sea más grande que la página del PDF.
            const defaultWidth = Math.min(signatureBox1Size.width, pdfPageRect.width * 0.8); // Máx 80% del ancho del PDF
            const defaultHeight = Math.min(signatureBox1Size.height, pdfPageRect.height * 0.8); // Máx 80% del alto del PDF

            // Calcular la posición inicial del recuadro de firma al centro de la página PDF visible
            let initialX = pdfLeftInViewer + (pdfPageRect.width / 2) - (defaultWidth / 2);
            let initialY = pdfTopInViewer + (pdfPageRect.height / 2) - (defaultHeight / 2);

            // Asegurar que el recuadro esté completamente dentro de los límites de la página PDF
            // (esto es especialmente importante si el tamaño por defecto es grande o la página es pequeña)
            initialX = Math.max(pdfLeftInViewer, Math.min(initialX, pdfLeftInViewer + pdfPageRect.width - defaultWidth));
            initialY = Math.max(pdfTopInViewer, Math.min(initialY, pdfTopInViewer + pdfPageRect.height - defaultHeight));

            setSignatureBox1Pos({ x: initialX, y: initialY });
            setSignatureBox1Size({ width: defaultWidth, height: defaultHeight });

            console.log('Recuadro 1 posicionado inicialmente:', {
                pdfPageRect: { width: pdfPageRect.width.toFixed(0), height: pdfPageRect.height.toFixed(0) },
                viewerScroll: { x: scrollX.toFixed(0), y: scrollY.toFixed(0) },
                pdfOffsetsInViewer: { left: pdfLeftInViewer.toFixed(0), top: pdfTopInViewer.toFixed(0) },
                initialBoxPos: { x: initialX.toFixed(0), y: initialY.toFixed(0) },
                initialBoxSize: { width: defaultWidth.toFixed(0), height: defaultHeight.toFixed(0) }
            });
        };

        // Darle un pequeño tiempo al renderizado de la página PDF para que las dimensiones estén disponibles.
        const timer = setTimeout(handleInitialBoxPosition, 100);

        return () => clearTimeout(timer); // Limpiar el timer al desmontar o si las dependencias cambian

    }, [showSignatureBox1, selectedFile, pageNumber, scale, pdfDocProxyRef.current]);


    // Efecto para medir el canvas del modal de dibujo (Recuadro 3)
    useEffect(() => {
        if (!showSignatureBox3 || !modalCanvasDrawingAreaRef.current) return;

        const measureCanvasAreaAndInitialize = () => {
            if (modalCanvasDrawingAreaRef.current) {
                const measuredWidth = modalCanvasDrawingAreaRef.current.clientWidth;
                const measuredHeight = modalCanvasDrawingAreaRef.current.clientHeight;

                if (measuredWidth > 0 && measuredHeight > 0) {
                    setSigCanvasWidth(measuredWidth);
                    setSigCanvasHeight(measuredHeight);
                    console.log("Canvas de firma medido:", { width: measuredWidth, height: measuredHeight });

                    if (sigCanvasRef.current) {
                        const canvas = sigCanvasRef.current.canvas;
                        if (canvas) {
                            if (canvas.width !== measuredWidth || canvas.height !== measuredHeight) {
                                canvas.width = measuredWidth;
                                canvas.height = measuredHeight;
                            }
                            sigCanvasRef.current.clear(); // Limpiar cualquier dibujo previo
                            sigCanvasRef.current.on(); // Habilitar dibujo
                        } else {
                            console.warn("sigCanvasRef.current.canvas no está listo, reintentando...");
                            setTimeout(measureCanvasAreaAndInitialize, 50); // Reintentar
                        }
                    } else {
                        console.warn("sigCanvasRef.current no está listo, reintentando...");
                        setTimeout(measureCanvasAreaAndInitialize, 50); // Reintentar
                    }
                } else {
                    console.warn("Área de canvas de firma tiene dimensiones cero, reintentando medida...");
                    setTimeout(measureCanvasAreaAndInitialize, 100); // Reintentar
                }
            }
        };

        // Iniciar la medición inicial del canvas del modal
        const initialMeasureTimer = setTimeout(() => {
            measureCanvasAreaAndInitialize();
        }, 100);

        // Añadir listener para re-medir el canvas si la ventana cambia de tamaño
        window.addEventListener('resize', measureCanvasAreaAndInitialize);

        // Función de limpieza para eliminar el listener del evento resize
        return () => {
            clearTimeout(initialMeasureTimer);
            window.removeEventListener('resize', measureCanvasAreaAndInitialize);
        };
    }, [showSignatureBox3]);


    // Handler para cuando se selecciona un nuevo archivo PDF
    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        setErrorMessage(''); // Limpiar mensajes de error previos
        setSelectedFile(null); // Resetear archivo seleccionado
        if (fileUrl) URL.revokeObjectURL(fileUrl); // Limpiar URL Blob anterior si existe para liberar memoria
        setFileUrl(null); // Resetear URL del archivo
        setNumPages(null); // Resetear número de páginas
        setPageNumber(1); // Volver a la primera página
        setScale(1.0); // Resetear zoom
        pdfDocProxyRef.current = null; // Resetear referencia al proxy del PDF
        setPdfOriginalBuffer(null); // Resetear buffer del PDF
        // Resetear estados de los recuadros de firma
        setShowSignatureBox1(false);
        setShowSignatureBox2(false);
        setShowSignatureBox3(false);
        setSignatureBox1Pos({ x: 0, y: 0 });
        setSignatureBox1Size({ width: 200, height: 100 });
        setIsDraggingBox(false);
        setIsResizingBox(false);
        setHasSignatureApplied(false); // Resetear si se han aplicado firmas
        setShowHelpModal(false); // Asegurar que el modal de ayuda está cerrado

        // Generar un nuevo processId y actualizar la URL al cargar un nuevo PDF
        // Esto asegura una URL única para cada nuevo archivo cargado.
        const newId = generateUniqueId(); // Usar la función general
        setProcessId(newId);
        window.location.hash = `proceso=${newId}`; // Actualizar el hash de la URL en el navegador


        if (file) {
            const MAX_FILE_SIZE_MB = 48; // Límite de tamaño de archivo PDF
            const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

            if (file.type !== 'application/pdf') {
                setErrorMessage('Error: Por favor, selecciona un archivo PDF válido.');
                return;
            }

            if (file.size > MAX_FILE_SIZE_BYTES) {
                setErrorMessage(`Error: El archivo es demasiado grande. Máximo ${MAX_FILE_SIZE_MB} MB.`);
                return;
            }

            try {
                const buffer = await file.arrayBuffer(); // Leer el archivo como ArrayBuffer
                setPdfOriginalBuffer(arrayBufferEncode(buffer)); // Codificar a Base64 para guardar en estado (y luego Supabase)
                setSelectedFile(file); // Guardar la referencia al archivo seleccionado
                // Crear una URL Blob para que react-pdf pueda renderizar el PDF
                setFileUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' })));
                console.log('Archivo PDF válido seleccionado:', file.name, 'Tamaño:', file.size, 'bytes');
            } catch (error) {
                console.error('Error al cargar el PDF:', error);
                setErrorMessage('Error al cargar el PDF. Detalles en consola.');
            }
        }
    };

    // Handler para cuando el documento PDF se carga correctamente en react-pdf
    const onDocumentLoadSuccess = ({ numPages: newNumPages, originalDocument }) => {
        setNumPages(newNumPages); // Actualizar el número total de páginas
        // Ajustar pageNumber solo si es necesario (evita sobrescribir si se cargó un proceso guardado)
        if (pageNumber === 1 || pageNumber > newNumPages) {
            setPageNumber(1); // Si la página actual es la primera o inválida, ir a la 1
        }
        // Reiniciar scroll del visor
        if (viewerRef.current) {
            viewerRef.current.scrollLeft = 0;
            viewerRef.current.scrollTop = 0;
        }
        pdfDocProxyRef.current = originalDocument; // Guardar referencia al objeto de documento de react-pdf

        // Ajustar la escala inicial del PDF para que quepa en el visor
        if (originalDocument && viewerRef.current) {
            originalDocument.getPage(1).then(page => {
                const viewport = page.getViewport({ scale: 1.0 });
                // Calcular el ancho disponible en el visor (considerando padding)
                const viewerInnerWidth = viewerRef.current ? viewerRef.current.clientWidth - (15 * 2) : viewport.width;
                // Solo ajustar la escala si no se ha cargado de un proceso guardado (donde la escala ya viene definida)
                // o si la escala actual es la por defecto (1.0)
                if (scale === 1.0) {
                    const initialScale = viewerInnerWidth / viewport.width;
                    setScale(Math.min(initialScale, 1.5)); // Limitar la escala máxima para evitar PDFs gigantes
                }
            }).catch(err => console.error("Error getting page for initial scale:", err));
        }
    };

    // Navegación de página
    const goToNextPage = () => {
        setPageNumber((prevPageNumber) => Math.min(prevPageNumber + 1, numPages));
    };
    const goToPrevPage = () => {
        setPageNumber((prevPageNumber) => Math.max(prevPageNumber - 1, 1));
    };

    // Arrastre del visor de PDF
    const handleZoom = (event) => {
        event.preventDefault();
        const delta = event.deltaY * -0.001; // Invertir el scroll para zoom y ajustar sensibilidad
        setScale((prevScale) => Math.max(0.5, Math.min(prevScale + delta, 3.0))); // Limitar zoom entre 0.5 y 3.0
    };

    // --- MODIFICACIÓN IMPORTANTE: Unificar manejadores de ratón y táctiles ---

    const getEventClientCoords = (e) => {
        if (e.touches && e.touches.length > 0) {
            return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
        }
        return { clientX: e.clientX, clientY: e.clientY };
    };

    const onStartInteraction = (e) => { // Usado para onMouseDown y onTouchStart
        // Prevenir el comportamiento por defecto del navegador para arrastre y zoom táctil
        e.preventDefault();
        e.stopPropagation(); // Evitar que el evento se propague si es un elemento interactivo anidado

        // Solo permitir interacción si no hay ningún proceso activo (firma o ayuda) y no es el lienzo de firma del modal
        if (e.target.closest('.signature-box-1') || e.target.closest('.signature-box-1-resize-handle') || e.target.closest('.signature-box-2') || e.target.closest('.signature-box-3-modal') || showHelpModal) {
            return;
        }

        if (viewerRef.current) {
            setIsDragging(true);
            const { clientX, clientY } = getEventClientCoords(e);
            setStartX(clientX - viewerRef.current.offsetLeft);
            setStartY(clientY - viewerRef.current.offsetTop);
            setScrollLeftInitial(viewerRef.current.scrollLeft);
            setScrollTopInitial(viewerRef.current.scrollTop);
            viewerRef.current.style.cursor = 'grabbing'; // Cambiar cursor a "grabbing"
        }
    };

    const onMoveInteraction = useCallback((e) => { // Usado para onMouseMove y onTouchMove
        // Si no estamos arrastrando el PDF, redimensionando o arrastrando el recuadro, salir
        if (!isDragging && !isResizingBox && !isDraggingBox) return;
        e.preventDefault(); // Prevenir el comportamiento por defecto del navegador (ej. selección de texto, scroll)

        const { clientX, clientY } = getEventClientCoords(e);

        if (isDragging) { // Lógica para arrastrar el PDF
            if (viewerRef.current) {
                const x = clientX - viewerRef.current.offsetLeft;
                const y = clientY - viewerRef.current.offsetTop;
                const walkX = (x - startX); // Distancia arrastrada en X
                const walkY = (y - startY); // Distancia arrastrada en Y
                viewerRef.current.scrollLeft = scrollLeftInitial - walkX; // Mover scroll horizontalmente
                viewerRef.current.scrollTop = scrollTopInitial - walkY; // Mover scroll verticalmente
            }
        } else if (isResizingBox) { // Lógica para redimensionar el recuadro de firma (Recuadro 1)
            // Asegurarse de que las referencias iniciales existan
            if (!initialBoxRect || !initialMousePos) {
                console.warn('initialBoxRect o initialMousePos es null en onMoveInteraction (redimensionamiento). Saltando.');
                return;
            }

            if (!viewerRef.current) return;
            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement) return;

            const pdfPageRect = pdfPageElement.getBoundingClientRect(); // Dimensiones del canvas del PDF en pantalla
            const viewerRect = viewerRef.current.getBoundingClientRect();

            const scrollX = viewerRef.current.scrollLeft;
            const scrollY = viewerRef.current.scrollTop;

            // Calcular la posición absoluta de la página PDF *dentro del área scrollable* del visor
            const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
            const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;
            const pdfRightInViewer = pdfLeftInViewer + pdfPageRect.width;
            const pdfBottomInViewer = pdfTopInViewer + pdfPageRect.height;

            const mouseCurrentX = clientX;
            const mouseCurrentY = clientY;

            let newWidth = initialBoxRect.width;
            let newHeight = initialBoxRect.height;
            let newX = initialBoxRect.x;
            let newY = initialBoxRect.y;

            const mouseDeltaX = mouseCurrentX - initialMousePos.x; // Cambio en posición X del ratón/dedo
            const mouseDeltaY = mouseCurrentY - initialMousePos.y; // Cambio en posición Y del ratón/dedo

            const MIN_BOX_SIZE = 50; // Tamaño mínimo para el recuadro

            // Aplicar lógica de redimensionamiento según el "handle" arrastrado
            if (resizeHandleType === 'br') { // Bottom-Right (redimensiona ancho y alto)
                newWidth = initialBoxRect.width + mouseDeltaX;
                newHeight = initialBoxRect.height + mouseDeltaY;
            } else if (resizeHandleType === 'bl') { // Bottom-Left (redimensiona ancho y mueve X, redimensiona alto)
                newWidth = initialBoxRect.width - mouseDeltaX;
                newHeight = initialBoxRect.height + mouseDeltaY;
                newX = initialBoxRect.x + mouseDeltaX; // Mover X al redimensionar desde la izquierda
            }

            // Asegurar que el tamaño no sea menor al mínimo
            newWidth = Math.max(newWidth, MIN_BOX_SIZE);
            newHeight = Math.max(newHeight, MIN_BOX_SIZE);

            // Limitar la posición para que el recuadro no se salga de la página PDF
            // Primero, ajustamos la posición x/y basándonos en los límites de la página
            newX = Math.max(pdfLeftInViewer, newX);
            newY = Math.max(pdfTopInViewer, newY);

            // Luego, ajustamos el ancho/alto para que no se extienda más allá del límite derecho/inferior de la página
            newWidth = Math.min(newWidth, pdfRightInViewer - newX);
            newHeight = Math.min(newHeight, pdfBottomInViewer - newY);

            // Finalmente, volvemos a asegurar el tamaño mínimo después de los ajustes de límite,
            // por si el ajuste de límite lo hizo más pequeño que MIN_BOX_SIZE (ej. si la página es muy pequeña)
            newWidth = Math.max(newWidth, MIN_BOX_SIZE);
            newHeight = Math.max(newHeight, MIN_BOX_SIZE);

            // Si al re-asegurar el tamaño mínimo, el recuadro se sale por la izquierda o arriba (solo si se redimensiona desde BL)
            // Ajustar la posición X para que el borde derecho no se mueva al crecer desde la izquierda
            if (resizeHandleType === 'bl' && newWidth > initialBoxRect.width - mouseDeltaX) {
                // Esta es una corrección sutil: si el nuevo ancho es mayor que el que se calcularía solo por el mouseDeltaX
                // (debido a la restricción de MIN_BOX_SIZE o límite de página), entonces la X también debe ajustarse
                // para mantener el borde derecho en su lugar (o cerca de él).
                newX = initialBoxRect.x - (newWidth - (initialBoxRect.width - mouseDeltaX));
                newX = Math.max(pdfLeftInViewer, newX); // Asegurar que no se salga del borde izquierdo del PDF
            }

            // Actualizar los estados del recuadro
            setSignatureBox1Pos({ x: newX, y: newY });
            setSignatureBox1Size({ width: newWidth, height: newHeight });

        } else if (isDraggingBox) { // Lógica para arrastrar el recuadro de firma (Recuadro 1)
            if (!viewerRef.current) return;
            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement) return;

            const pdfPageRect = pdfPageElement.getBoundingClientRect();
            const viewerRect = viewerRef.current.getBoundingClientRect();

            const scrollX = viewerRef.current.scrollLeft;
            const scrollY = viewerRef.current.scrollTop;

            // Calcular límites de la página PDF *dentro del área scrollable* del visor
            const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
            const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;
            const pdfRightInViewer = pdfLeftInViewer + pdfPageRect.width;
            const pdfBottomInViewer = pdfTopInViewer + pdfPageRect.height;

            // Calcular la nueva posición del recuadro basándose en el movimiento del ratón/dedo y el offset inicial
            const newX = (clientX - viewerRect.left) + scrollX - boxDragOffsetX;
            const newY = (clientY - viewerRect.top) + scrollY - boxDragOffsetY;

            // Limitar las coordenadas para que el recuadro no se salga de la página PDF
            let finalX = Math.max(pdfLeftInViewer, Math.min(newX, pdfRightInViewer - signatureBox1Size.width));
            let finalY = Math.max(pdfTopInViewer, Math.min(newY, pdfBottomInViewer - signatureBox1Size.height));

            setSignatureBox1Pos({ x: finalX, y: finalY });
        }
    }, [
        isDragging, isResizingBox, isDraggingBox,
        startX, startY, scrollLeftInitial, scrollTopInitial,
        initialBoxRect, initialMousePos, resizeHandleType, // Dependencias para redimensionamiento/arrastre
        signatureBox1Pos, signatureBox1Size, boxDragOffsetX, boxDragOffsetY
    ]);

    const onEndInteraction = useCallback(() => { // Usado para onMouseUp y onTouchEnd
        setIsDragging(false);
        setIsDraggingBox(false);
        setIsResizingBox(false);
        setResizeHandleType(null);
        setInitialMousePos(null); // Limpiar estado inicial del ratón
        setInitialBoxRect(null); // Limpiar estado inicial del recuadro

        if (viewerRef.current) {
            viewerRef.current.style.cursor = 'grab'; // Restaurar cursor del visor
        }
    }, []);

    // Handler global para cuando el puntero sale de la ventana (detiene arrastre/redimensionamiento)
    const onLeaveWindowGlobal = useCallback(() => { // Usado para onMouseLeave
        if (isDragging || isDraggingBox || isResizingBox) {
            onEndInteraction(); // Finalizar cualquier operación activa
        }
    }, [isDragging, isDraggingBox, isResizingBox, onEndInteraction]);


    // Configuración de listeners de eventos globales al montar el componente
    useEffect(() => {
        // Eventos de ratón
        window.addEventListener('mouseup', onEndInteraction);
        window.addEventListener('mousemove', onMoveInteraction);
        window.addEventListener('mouseleave', onLeaveWindowGlobal); // Para cuando el ratón sale de la ventana

        // Eventos táctiles
        window.addEventListener('touchend', onEndInteraction);
        window.addEventListener('touchmove', onMoveInteraction, { passive: false }); // `passive: false` para permitir preventDefault
        window.addEventListener('touchcancel', onEndInteraction); // En caso de interrupción táctil

        return () => { // Función de limpieza para remover listeners al desmontar
            // Remover eventos de ratón
            window.removeEventListener('mouseup', onEndInteraction);
            window.removeEventListener('mousemove', onMoveInteraction);
            window.removeEventListener('mouseleave', onLeaveWindowGlobal);

            // Remover eventos táctiles
            window.removeEventListener('touchend', onEndInteraction);
            window.removeEventListener('touchmove', onMoveInteraction);
            window.removeEventListener('touchcancel', onEndInteraction);
        };
    }, [onEndInteraction, onMoveInteraction, onLeaveWindowGlobal]);


    // Handler para iniciar el arrastre del recuadro de firma (Recuadro 1)
    const onSignatureBoxStart = (e) => { // Usado para onMouseDown y onTouchStart
        e.stopPropagation(); // Prevenir que el evento se propague al visor del PDF
        e.preventDefault(); // ¡NUEVO Y CRUCIAL! Evitar comportamiento de scroll/zoom del navegador

        // Si el clic/toque es en un handle de redimensionamiento, no iniciar el arrastre de la caja completa
        if (e.target.classList.contains('signature-box-1-resize-handle')) {
            return;
        }

        setIsDraggingBox(true); // Activar arrastre del recuadro
        const { clientX, clientY } = getEventClientCoords(e);
        // Calcular offset del clic dentro del recuadro
        setBoxDragOffsetX(clientX - e.currentTarget.getBoundingClientRect().left);
        setBoxDragOffsetY(clientY - e.currentTarget.getBoundingClientRect().top);
        // Guardar posición inicial del ratón/dedo y el recuadro para cálculos precisos al mover
        setInitialMousePos({ x: clientX, y: clientY });
        setInitialBoxRect({
            x: signatureBox1Pos.x,
            y: signatureBox1Pos.y,
            width: signatureBox1Size.width,
            height: signatureBox1Size.height,
        });
    };

    // Handler para iniciar el redimensionamiento del recuadro de firma (Recuadro 1)
    const onResizeHandleStart = (e, type) => { // Usado para onMouseDown y onTouchStart
        e.stopPropagation(); // Prevenir que el evento se propague
        e.preventDefault(); // ¡NUEVO Y CRUCIAL! Evitar comportamiento de scroll/zoom del navegador
        setIsResizingBox(true); // Activar redimensionamiento
        setResizeHandleType(type); // Establecer el tipo de handle (ej. 'br' (bottom-right), 'bl' (bottom-left))
        const { clientX, clientY } = getEventClientCoords(e);
        // Guardar posición inicial del recuadro y del ratón/dedo para cálculos de redimensionamiento
        setInitialBoxRect({
            x: signatureBox1Pos.x,
            y: signatureBox1Pos.y,
            width: signatureBox1Size.width,
            height: signatureBox1Size.height,
        });
        setInitialMousePos({ x: clientX, y: clientY });
    };


    // Variable de conveniencia para deshabilitar botones si hay un proceso activo (firma o modal de ayuda)
    const isProcessActive = showSignatureBox1 || showSignatureBox2 || showSignatureBox3 || showHelpModal;
    const isAddSignatureButtonDisabled = !selectedFile || errorMessage || isProcessActive;

    // Handler para el botón "Añadir Firma"
    const handleAddSignatureClick = () => {
        if (isAddSignatureButtonDisabled) {
            setErrorMessage('Por favor, sube un PDF y/o finaliza el proceso de firma actual antes de añadir otra.');
            setTimeout(() => setErrorMessage(''), 3000);
            return;
        }
        setErrorMessage(''); // Limpiar errores
        // Mostrar Recuadro 1 e inicializar su posición/tamaño
        setShowSignatureBox1(true);
        setShowSignatureBox2(false);
        setShowSignatureBox3(false);
        // La posición inicial se calculará en useEffect
        // setSignatureBox1Pos({ x: 0, y: 0 }); // Ya no es necesario inicializar aquí
        // setSignatureBox1Size({ width: 200, height: 100 }); // Ya no es necesario inicializar aquí
        setIsDraggingBox(false);
        setIsResizingBox(false);
    };

    // Handlers para los botones de control de los recuadros de firma
    const handleCancelSignatureBox1 = () => {
        setShowSignatureBox1(false);
    };
    const handleConfirmSignatureBox1 = () => {
        setFinalSignaturePos(signatureBox1Pos); // Confirmar posición del recuadro 1
        setFinalSignatureSize(signatureBox1Size); // Confirmar tamaño del recuadro 1
        setShowSignatureBox1(false); // Ocultar Recuadro 1
        setShowSignatureBox2(true); // Mostrar Recuadro 2
    };
    const handleCancelSignatureBox2 = () => {
        setShowSignatureBox2(false); // Ocultar Recuadro 2
        setShowSignatureBox1(true); // Volver a mostrar Recuadro 1 para reajustar
    };
    const handleConfirmSignature2 = () => {
        setShowSignatureBox2(false); // Ocultar Recuadro 2
        setShowSignatureBox3(true); // Mostrar Recuadro 3 (modal de dibujo)
    };
    const handleCancelSignatureBox3 = () => {
        setShowSignatureBox3(false); // Ocultar Recuadro 3
        setShowSignatureBox2(true); // Volver a mostrar Recuadro 2 (para re-dibujar si se desea)
        if (sigCanvasRef.current) {
            sigCanvasRef.current.clear(); // Limpiar canvas de firma
        }
    };
    const handleClearSignature = () => {
        if (sigCanvasRef.current) {
            sigCanvasRef.current.clear(); // Limpiar canvas de firma
        }
    };

    // Handler para incrustar la firma en el PDF
    const handleConfirmSignature3 = async () => {
        if (sigCanvasRef.current && !sigCanvasRef.current.isEmpty()) {
            const signatureDataURL = sigCanvasRef.current.toDataURL('image/png'); // Obtener la firma como DataURL

            setShowSignatureBox3(false); // Ocultar el modal de dibujo
            sigCanvasRef.current.clear(); // Limpiar el canvas de firma para la próxima vez

            if (!pdfOriginalBuffer) {
                console.error('No hay un buffer de PDF (Base64) válido en el estado para incrustar la firma.');
                setErrorMessage('Error: Vuelve a cargar el PDF e intenta nuevamente. (Buffer Base64 no disponible).');
                return;
            }

            let pdfArrayBuffer;
            try {
                pdfArrayBuffer = arrayBufferDecode(pdfOriginalBuffer); // Decodificar el PDF actual de Base64 a ArrayBuffer
            } catch (error) {
                console.error('Error al decodificar el buffer Base64 del PDF:', error);
                setErrorMessage('Error: No se pudo preparar el PDF para la firma. Intenta cargarlo de nuevo.');
                return;
            }

            try {
                const pdfDoc = await PDFDocument.load(pdfArrayBuffer); // Cargar el PDF con pdf-lib
                const signatureImage = await pdfDoc.embedPng(signatureDataURL); // Incrustar la imagen de la firma

                const pages = pdfDoc.getPages();
                if (pageNumber < 1 || pageNumber > pages.length) {
                    throw new Error(`Página ${pageNumber} fuera de rango. Total páginas: ${pages.length}`);
                }
                const currentPage = pages[pageNumber - 1]; // Obtener la página actual del PDF (índice base 0)

                const pageSize = currentPage.getSize(); // Obtener las dimensiones nativas de la página del PDF
                const pdfNativeWidth = pageSize.width;
                const pdfNativeHeight = pageSize.height;

                const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
                if (!pdfPageElement) {
                    console.error("Elemento de página PDF no encontrado para cálculos de incrustación.");
                    setErrorMessage('Error: El visor de PDF no está listo para la incrustación.');
                    return;
                }
                const pdfPageRect = pdfPageElement.getBoundingClientRect(); // Dimensiones del canvas renderizado en pantalla
                const viewerRect = viewerRef.current.getBoundingClientRect(); // Dimensiones del contenedor del visor

                // Calcular el scroll actual del visor
                const scrollX = viewerRef.current.scrollLeft;
                const scrollY = viewerRef.current.scrollTop;

                // Calcular la posición absoluta de la página PDF *dentro del área scrollable* del visor
                // Esto es la posición X/Y del borde superior izquierdo de la página PDF relativa al inicio del área scrollable.
                const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
                const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;

                // Calcular la relación de escala entre el PDF nativo y el PDF renderizado en el DOM
                const scaleX = pdfPageRect.width / pdfNativeWidth;
                const scaleY = pdfPageRect.height / pdfNativeHeight;

                // Convertir la posición y tamaño del recuadro (en coordenadas de pantalla/visor)
                // a las coordenadas nativas del PDF
                const signatureXInPdfNative = (finalSignaturePos.x - pdfLeftInViewer) / scaleX;
                const signatureYInPdfNative = (finalSignaturePos.y - pdfTopInViewer) / scaleY;
                const signatureWidthInPdfNative = finalSignatureSize.width / scaleX;
                const signatureHeightInPdfNative = finalSignatureSize.height / scaleY;

                // IMPORTANTÍSIMO: Las coordenadas Y en pdf-lib son desde la parte inferior de la página, no la superior.
                // Necesitamos ajustar la Y para dibujar correctamente.
                const drawY = pdfNativeHeight - (signatureYInPdfNative + signatureHeightInPdfNative);

                console.log("Incrustando firma:", {
                    pageNumber: pageNumber,
                    viewerCoords: finalSignaturePos,
                    viewerSize: finalSignatureSize,
                    pdfPageRect: { width: pdfPageRect.width.toFixed(0), height: pdfPageRect.height.toFixed(0) },
                    pdfNativeSize: { width: pdfNativeWidth.toFixed(0), height: pdfNativeHeight.toFixed(0) },
                    scales: { x: scaleX.toFixed(2), y: scaleY.toFixed(2) },
                    signatureInPdfNative: { x: signatureXInPdfNative.toFixed(2), y: signatureYInPdfNative.toFixed(2), width: signatureWidthInPdfNative.toFixed(2), height: signatureHeightInPdfNative.toFixed(2) },
                    drawYInPdfLib: drawY.toFixed(2)
                });

                // Dibujar la firma en la página del PDF
                currentPage.drawImage(signatureImage, {
                    x: signatureXInPdfNative,
                    y: drawY,
                    width: signatureWidthInPdfNative,
                    height: signatureHeightInPdfNative,
                    opacity: 1, // Opacidad de la firma
                });

                const modifiedPdfBytes = await pdfDoc.save(); // Guardar el PDF modificado
                const modifiedPdfBlob = new Blob([modifiedPdfBytes], { type: 'application/pdf' }); // Crear un Blob

                // Revocar la URL anterior y crear una nueva para el PDF modificado
                if (fileUrl) URL.revokeObjectURL(fileUrl);
                setFileUrl(URL.createObjectURL(modifiedPdfBlob));
                setSelectedFile(modifiedPdfBlob); // Actualizar selectedFile para que represente el PDF modificado

                // Actualizar el buffer del PDF en Base64 con la versión firmada
                setPdfOriginalBuffer(arrayBufferEncode(modifiedPdfBytes));

                setHasSignatureApplied(true); // Marcar que al menos una firma ha sido aplicada exitosamente

                console.log('Firma incrustada exitosamente en el PDF.');
                setErrorMessage('Firma añadida exitosamente.');
                setTimeout(() => setErrorMessage(''), 3000);

            } catch (error) {
                console.error('Error al incrustar la firma:', error);
                setErrorMessage(`Error al incrustar la firma. Detalles: ${error.message}. ¿El PDF está protegido o hay un problema con las coordenadas?`);
                setShowSignatureBox2(true); // Si hay un error, volver al paso de confirmación del área
            }
        } else {
            console.warn('No se dibujó ninguna firma.');
            setErrorMessage('Por favor, dibuja una firma antes de confirmar.');
            setTimeout(() => setErrorMessage(''), 3000);
        }
    };

    // Función para guardar el PDF actual (descargar a la computadora del usuario)
    const handleSavePdf = () => {
        if (fileUrl) {
            const a = document.createElement('a'); // Crear un elemento <a> temporal
            a.href = fileUrl; // Establecer el href a la URL del PDF actual
            // Generar un nombre de archivo, añadiendo "_firmado.pdf" si ya tiene .pdf
            const filename = selectedFile && selectedFile.name ?
                selectedFile.name.replace(/\.pdf$/, '_firmado.pdf') :
                'documento_firmado.pdf';
            a.download = filename; // Establecer el nombre para la descarga
            document.body.appendChild(a); // Añadir el enlace al DOM
            a.click(); // Simular un clic en el enlace para iniciar la descarga
            document.body.removeChild(a); // Eliminar el enlace del DOM
            setErrorMessage('PDF guardado exitosamente en tu dispositivo.');
            setTimeout(() => setErrorMessage(''), 3000);
        } else {
            setErrorMessage('No hay un PDF para guardar.');
            setTimeout(() => setErrorMessage(''), 3000);
        }
    };

    // NUEVA FUNCIÓN: Para guardar el estado del proceso en Supabase
    const handleSaveProcess = async () => {
        if (!selectedFile) {
            setErrorMessage('Carga un PDF antes de guardar el proceso.');
            setTimeout(() => setErrorMessage(''), 3000);
            return;
        }
        // Asegurarse de que tenemos un ID de proceso y un ID de usuario
        if (!processId || !userId) {
            setErrorMessage('Error: ID de proceso o usuario no disponible. Intenta recargar la página.');
            setTimeout(() => setErrorMessage(''), 7000);
            return;
        }

        try {
            // Capturar el estado relevante de la aplicación
            const processState = {
                pdfOriginalBuffer: pdfOriginalBuffer, // El PDF actual (Base64)
                numPages, // Número total de páginas
                pageNumber, // Página actual
                scale, // Nivel de zoom
                hasSignatureApplied, // Si se han aplicado firmas
                showSignatureBox1,
                signatureBox1Pos,
                signatureBox1Size,
                showSignatureBox2,
                finalSignaturePos,
                finalSignatureSize,
                showSignatureBox3: false // Siempre guardar como false para que el proceso retome desde Recuadro 2 si estaba dibujando
            };

            // Realizar un 'upsert' en la tabla 'process_states' de Supabase
            // Si el 'id' (processId) ya existe, actualiza; si no, inserta uno nuevo.
            // eslint-disable-next-line no-unused-vars
            const { data, error } = await supabase
                .from('process_states')
                .upsert(
                    {
                        id: processId, // Usar el processId actual como ID del registro en la BD
                        user_id: userId, // Guardar el ID del usuario que lo guardó
                        state_data: processState, // Guardar el objeto de estado completo
                        // created_at se genera automáticamente en Supabase si no se proporciona
                    },
                    { onConflict: 'id' } // Estrategia de conflicto: actualizar si el ID existe
                );

            if (error) {
                throw error; // Lanzar el error si Supabase reporta uno
            }

            setErrorMessage('Proceso guardado con éxito en línea. Puedes compartir esta URL.');
            setTimeout(() => setErrorMessage(''), 5000);
        } catch (error) {
            console.error('Error al guardar el proceso en Supabase:', error);
            setErrorMessage(`Error al guardar el proceso: ${error.message}. Asegúrate que Supabase esté configurado y tengas conexión a internet.`);
            setTimeout(() => setErrorMessage(''), 7000);
        }
    };

    // Función para copiar la URL actual del proceso al portapapeles (para compartir)
    const handleShareButton = () => {
        if (!processId || !selectedFile) {
            setErrorMessage('Carga un PDF y guarda el proceso para obtener una URL compartible.');
            setTimeout(() => setErrorMessage(''), 4000);
            return;
        }
        // Construir la URL completa que incluye el hash del processId
        const urlToCopy = `${window.location.origin}${window.location.pathname}#proceso=${processId}`;

        navigator.clipboard.writeText(urlToCopy) // Usar Clipboard API para copiar texto
            .then(() => {
                setErrorMessage('URL del proceso copiada al portapapeles.');
                setTimeout(() => setErrorMessage(''), 3000);
            })
            .catch(err => {
                console.error('Error al copiar la URL:', err);
                setErrorMessage('Error al copiar la URL. Tu navegador podría no permitirlo. Intenta copiarla manualmente de la barra de direcciones.');
                setTimeout(() => setErrorMessage(''), 5000);
            });
    };

    // Función para abrir el modal de ayuda
    const handleOpenHelpModal = () => {
        setShowHelpModal(true);
    };

    // Función para cerrar el modal de ayuda
    const handleCloseHelpModal = () => {
        setShowHelpModal(false);
    };


    return (
        <div className="app-container">
            <header className="app-header">
                <h1 className="app-title">Página de Firmas y Visor de PDFs</h1>
                {/* Aquí puedes añadir información del usuario o del proceso si lo deseas */}
                {/* {userId && <span className="user-id-display">ID de Usuario: {userId}</span>} */}
                {/* {processId && <span className="process-id-display">ID de Proceso: {processId}</span>} */}
            </header>

            <main className="app-main-content">
                <div className="top-control-panel">
                    {/* Botón para seleccionar archivo PDF */}
                    <label htmlFor="pdf-upload" className="action-button select-file-button">
                        Seleccionar archivo
                    </label>
                    <input
                        type="file"
                        id="pdf-upload"
                        accept=".pdf,application/pdf"
                        style={{ display: 'none' }} // Ocultar el input nativo
                        onChange={handleFileChange}
                    />

                    {/* Muestra el nombre del archivo seleccionado o un estado por defecto */}
                    {selectedFile ? (
                        <span className="file-status-text">
                            Archivo seleccionado: <strong>{selectedFile.name}</strong>
                        </span>
                    ) : (
                        <span className="file-status-text default-status">
                            Sin archivos cargados
                        </span>
                    )}

                    {/* Botón original "Añadir Firma" */}
                    <button
                        className="action-button primary-action"
                        onClick={handleAddSignatureClick}
                        disabled={isAddSignatureButtonDisabled} // Deshabilitado si no hay archivo o proceso activo
                    >
                        Añadir Firma ✍️
                    </button>

                    {/* Nuevo botón "Añadir Firma" (solo emoji), visible después de la primera firma incrustada */}
                    {hasSignatureApplied && (
                        <button
                            className="action-button primary-action emoji-add-button"
                            onClick={handleAddSignatureClick}
                            disabled={isAddSignatureButtonDisabled}
                            title="Añadir otra firma" // Tooltip para accesibilidad
                        >
                            ➕
                        </button>
                    )}

                    {/* Botón para descargar el PDF actual (Guardar PDF) */}
                    <button
                        className="action-button"
                        onClick={handleSavePdf}
                        disabled={!selectedFile || isProcessActive} // Deshabilitado si no hay PDF o si un proceso está activo
                    >
                        Guardar 📁
                    </button>

                    {/* Nuevo botón: Guardar Proceso (guarda el estado en Supabase) */}
                    <button
                        className="action-button save-process-button"
                        onClick={handleSaveProcess}
                        disabled={!selectedFile || showHelpModal || !processId || !userId}
                        title="Guarda el estado actual de tu trabajo (incluyendo el PDF y el recuadro de firma si está activo) en línea. Se asocia a esta URL única para que puedas continuar más tarde o compartirla."
                    >
                        Guardar Proceso 💾
                    </button>

                    {/* Botón para Compartir (copia la URL del proceso al portapapeles) */}
                    <button
                        className="action-button"
                        onClick={handleShareButton}
                        disabled={!selectedFile || !processId || showHelpModal}
                        title="Copia la URL única de este proceso al portapapeles para compartirlo con otros."
                    >
                        Compartir 📤
                    </button>

                    {/* Botón para abrir el modal de ayuda */}
                    <button
                        className="action-button help-button"
                        onClick={handleOpenHelpModal}
                        disabled={isProcessActive} // Deshabilitado si un proceso de firma está activo
                    >
                        Cómo usar la página ❓
                    </button>

                    {/* Controles de navegación de páginas (Anterior / Siguiente) */}
                    {numPages && (
                        <div className="pdf-top-navigation">
                            <button onClick={goToPrevPage} disabled={pageNumber <= 1 || isProcessActive}>⬅️ Anterior</button>
                            <span className="page-indicator">Página {pageNumber} de {numPages}</span>
                            <button onClick={goToNextPage} disabled={pageNumber >= numPages || isProcessActive}>Siguiente ➡️</button>
                        </div>
                    )}
                </div>

                {/* Área para mostrar mensajes de error/éxito */}
                {errorMessage && (
                    <p className="error-message">{errorMessage}</p>
                )}

                {/* Visor de PDF */}
                {fileUrl && !errorMessage ? (
                    <div className="pdf-viewer-container">
                        <div
                            className="pdf-document-wrapper"
                            onWheel={handleZoom} // Habilitar zoom con rueda del ratón
                            ref={viewerRef} // Referencia para controlar scroll
                            onMouseDown={onStartInteraction} // Iniciar arrastre del PDF (ratón)
                            onTouchStart={onStartInteraction} // Iniciar arrastre del PDF (táctil)
                        >
                            <Document
                                file={fileUrl} // La URL Blob del PDF
                                onLoadSuccess={onDocumentLoadSuccess} // Callback al cargar el documento
                                onLoadError={console.error} // Callback si hay error al cargar
                                loading={<p style={{ color: '#8bbdff' }}>Cargando PDF...</p>} // Contenido mientras carga
                            >
                                <Page
                                    pageNumber={pageNumber} // Página actual a mostrar
                                    scale={scale} // Escala de visualización
                                    renderTextLayer={true} // Habilitar selección de texto
                                    renderAnnotationLayer={true} // Habilitar anotaciones si las hay
                                    className="pdf-page"
                                    width={600} // Ancho de renderizado de la página (react-pdf ajustará la altura)
                                />
                            </Document>

                            {/* Indicador de Zoom */}
                            <div className={`zoom-indicator ${isDragging ? 'visible' : ''}`}>
                                Zoom: {(scale * 100).toFixed(0)}%
                            </div>

                            {/* RECUADRO 1: El recuadro de selección de firma (movible y redimensionable) */}
                            {showSignatureBox1 && (
                                <div
                                    className={`signature-box-1 ${isDraggingBox ? 'is-dragging' : ''} ${isResizingBox ? 'is-resizing' : ''}`}
                                    style={{
                                        left: signatureBox1Pos.x + 'px',
                                        top: signatureBox1Pos.y + 'px',
                                        width: signatureBox1Size.width + 'px',
                                        height: signatureBox1Size.height + 'px',
                                    }}
                                    onMouseDown={onSignatureBoxStart} // Iniciar arrastre del recuadro (ratón)
                                    onTouchStart={onSignatureBoxStart} // Iniciar arrastre del recuadro (táctil)
                                >
                                    <div className="signature-box-1-buttons">
                                        <button className="signature-box-1-button cancel-button" onClick={handleCancelSignatureBox1}>❌</button>
                                        <button className="signature-box-1-button confirm-button" onClick={handleConfirmSignatureBox1}>✅</button>
                                    </div>
                                    {/* Handles de redimensionamiento */}
                                    <div
                                        className="signature-box-1-resize-handle bottom-right"
                                        onMouseDown={(e) => onResizeHandleStart(e, 'br')} // Iniciar redimensionamiento (ratón)
                                        onTouchStart={(e) => onResizeHandleStart(e, 'br')} // Iniciar redimensionamiento (táctil)
                                    ></div>
                                    <div
                                        className="signature-box-1-resize-handle bottom-left"
                                        onMouseDown={(e) => onResizeHandleStart(e, 'bl')} // Iniciar redimensionamiento (ratón)
                                        onTouchStart={(e) => onResizeHandleStart(e, 'bl')} // Iniciar redimensionamiento (táctil)
                                    ></div>
                                </div>
                            )}

                            {/* RECUADRO 2: Confirmación de área (estático, después de posicionar el Recuadro 1) */}
                            {showSignatureBox2 && (
                                <div
                                    className="signature-box-2"
                                    style={{
                                        left: finalSignaturePos.x + 'px',
                                        top: finalSignaturePos.y + 'px',
                                        width: finalSignatureSize.width + 'px',
                                        height: finalSignatureSize.height + 'px',
                                    }}
                                >
                                    <div className="signature-box-2-content">
                                        Área seleccionada. ¿Es correcta?
                                    </div>
                                    <div className="signature-box-2-buttons">
                                        <button className="signature-box-2-button cancel-button" onClick={handleCancelSignatureBox2}>❌</button>
                                        <button className="signature-box-2-button confirm-button" onClick={handleConfirmSignature2}>🖋️</button>
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                ) : (
                    // Mensaje o imagen cuando no hay PDF cargado o hay un error
                    <div className="no-pdf-placeholder">
                        {!errorMessage && <p>Sube un PDF para empezar a trabajar con él.</p>}
                    </div>
                )}
            </main>

            {/* MODAL DEL RECUADRO 3: RENDERIZADO FUERA DEL VISOR DEL PDF (modal de dibujo de firma) */}
            {showSignatureBox3 && (
                <div className="modal-overlay">
                    <div
                        className="signature-box-3-modal"
                        ref={modalCanvasDrawingAreaRef}
                    >
                        <h2>Dibuja tu firma</h2>
                        <div className="signature-box-3-drawing-area">
                            <SignatureCanvas
                                ref={sigCanvasRef}
                                canvasProps={{
                                    className: 'signature-canvas-modal',
                                    width: sigCanvasWidth,
                                    height: sigCanvasHeight,
                                }}
                                penColor='black'
                                minWidth={1}
                                maxWidth={2}
                                backgroundColor='white'
                                onBegin={() => setErrorMessage('')} // Limpiar errores al empezar a dibujar
                            />
                        </div>
                        <div className="signature-box-3-buttons">
                            <button className="signature-box-3-button cancel-button" onClick={handleCancelSignatureBox3}>❌ Cancelar</button>
                            <button className="signature-box-3-button clear-button" onClick={handleClearSignature}>↩️ Limpiar</button>
                            <button className="signature-box-3-button confirm-button" onClick={handleConfirmSignature3}>✅ Firmar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE AYUDA (se superpone sobre todo) */}
            {showHelpModal && (
                <div className="modal-overlay">
                    <div className="help-modal">
                        <h2 className="help-modal-title">Cómo usar esta página ❓</h2>
                        <p className="help-modal-description">Esta aplicación te permite visualizar PDFs y añadir firmas de manera sencilla. Sigue los pasos:</p>
                        <ol className="help-modal-list">
                            <li>Haz clic en "Seleccionar archivo" para cargar tu PDF.</li>
                            <li>Una vez cargado, haz clic en "Añadir Firma ✍️" para iniciar el proceso de firma.</li>
                            <li>Aparecerá un recuadro rojo: arrástralo y redimensiona para definir dónde quieres tu firma. Luego, haz clic en ✅.</li>
                            <li>Aparecerá un recuadro azul: es la confirmación del área seleccionada. Si es correcta, haz clic en 🖋️ para ir al lienzo de dibujo. Si no, haz clic en ❌ para reajustar.</li>
                            <li>En el lienzo de dibujo, usa tu ratón o dispositivo táctil para dibujar tu firma. Puedes usar "Limpiar ↩️" si necesitas empezar de nuevo.</li>
                            <li>Cuando estés satisfecho con tu firma, haz clic en "Firmar ✅" para incrustarla en el PDF.</li>
                            <li>Una vez incrustada, puedes "Guardar 📁" el PDF con la firma en tu dispositivo o añadir más firmas si lo deseas.</li>
                        </ol>
                        <h3 className="help-modal-subtitle">Funciones de cada botón:</h3>
                        <ul className="help-modal-buttons-list">
                            <li>**Seleccionar archivo:** Carga un documento PDF desde tu dispositivo.</li>
                            <li>**Añadir Firma ✍️:** Inicia el proceso para agregar una firma al PDF.</li>
                            <li>**➕ (Añadir otra firma):** Aparece después de incrustar la primera firma para que puedas añadir más rápidamente.</li>
                            <li>**Guardar 📁:** Descarga el PDF actual (con o sin firmas) a tu dispositivo.</li>
                            <li>**Guardar Proceso 💾:** Guarda el estado actual de tu trabajo (incluyendo el PDF y el recuadro de firma si está activo) en línea, asociándolo a esta URL única para que puedas continuar más tarde o compartir.</li>
                            <li>**Compartir 📤:** Copia la URL actual al portapapeles, permitiendo que otro usuario acceda a tu proceso guardado.</li>
                            <li>**Cómo usar la página ❓:** Muestra este recuadro de ayuda.</li>
                            <li>**⬅️ Anterior / Siguiente ➡️:** Navega entre las páginas del PDF.</li>
                            <li>**❌ (Botones Cancelar):** Cancela el paso actual en el proceso de firma.</li>
                            <li>**✅ (Botón Confirmar Recuadro 1):** Confirma la posición y tamaño del área de firma.</li>
                            <li>**🖋️ (Botón Confirmar Recuadro 2):** Abre el lienzo para dibujar tu firma.</li>
                            <li>**↩️ Limpiar (Botón Modal Firma):** Borra el dibujo actual en el lienzo de firma.</li>
                            <li>**✅ Firmar (Botón Modal Firma):** Incrusta tu firma dibujada en el PDF.</li>
                        </ul>
                        <button className="help-modal-close-button action-button" onClick={handleCloseHelpModal}>Cerrar</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;