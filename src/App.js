import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import SignatureCanvas from 'react-signature-canvas';
import { PDFDocument } from 'pdf-lib';
import { decode as arrayBufferDecode, encode as arrayBufferEncode } from 'base64-arraybuffer';

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

import { createClient } from '@supabase/supabase-js';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

console.log("DEPURACIÓN: Valor de REACT_APP_SUPABASE_URL:", process.env.REACT_APP_SUPABASE_URL);
console.log("DEPURACIÓN: Valor de REACT_APP_SUPABASE_ANON_KEY:", process.env.REACT_APP_SUPABASE_ANON_KEY);

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Faltan las variables de entorno de Supabase. Asegúrate de configurar REACT_APP_SUPABASE_URL y REACT_APP_SUPABASE_ANON_KEY en tu archivo .env");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const generateUniqueId = () => uuidv4();


function App() {
    const [selectedFile, setSelectedFile] = useState(null);
    const [pdfOriginalBuffer, setPdfOriginalBuffer] = useState(null);

    const [fileUrl, setFileUrl] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [numPages, setNumPages] = useState(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.0);

    const viewerRef = useRef(null);

    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [startY, setStartY] = useState(0);
    const [scrollLeftInitial, setScrollLeftInitial] = useState(0);
    const [scrollTopInitial, setScrollTopInitial] = useState(0);

    const [initialPinchDistance, setInitialPinchDistance] = useState(null);
    const [initialPinchScale, setInitialPinchScale] = useState(1.0);

    const [showSignatureBox1, setShowSignatureBox1] = useState(false);
    const [signatureBox1Pos, setSignatureBox1Pos] = useState({ x: 0, y: 0 });
    const [signatureBox1Size, setSignatureBox1Size] = useState({ width: 200, height: 100 });

    const [isDraggingBox, setIsDraggingBox] = useState(false);
    const [boxDragOffsetX, setBoxDragOffsetX] = useState(0);
    const [boxDragOffsetY, setBoxDragOffsetY] = useState(0);

    const [isResizingBox, setIsResizingBox] = useState(false);
    const [resizeHandleType, setResizeHandleType] = useState(null);
    const [initialBoxRect, setInitialBoxRect] = useState(null);
    const [initialMousePos, setInitialMousePos] = useState(null);

    const [showSignatureBox2, setShowSignatureBox2] = useState(false);
    const [finalSignaturePos, setFinalSignaturePos] = useState({ x: 0, y: 0 });
    const [finalSignatureSize, setFinalSignatureSize] = useState({ width: 0, height: 0 });

    const [showSignatureBox3, setShowSignatureBox3] = useState(false);
    const sigCanvasRef = useRef(null);
    const modalCanvasDrawingAreaRef = useRef(null);
    const [sigCanvasWidth, setSigCanvasWidth] = useState(0);
    const [sigCanvasHeight, setSigCanvasHeight] = useState(0);
    const pdfDocProxyRef = useRef(null);

    const [hasSignatureApplied, setHasSignatureApplied] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [processId, setProcessId] = useState(null);
    const [userId, setUserId] = useState(null);


    // EFECTO 1: Generación de userId local al inicio - ¡AHORA USA localStorage!
    useEffect(() => {
        let currentUserId = localStorage.getItem('app_user_id');
        if (!currentUserId) {
            currentUserId = generateUniqueId();
            localStorage.setItem('app_user_id', currentUserId);
        }
        setUserId(currentUserId);
        console.log("UserID de sesión:", currentUserId);
    }, []);


    // EFECTO 2: Carga inicial de la aplicación y gestión del processId en URL
    useEffect(() => {
        if (!userId) return; // Esperar a que el userId esté disponible.

        const loadInitialProcess = async () => {
            const hash = window.location.hash;
            const params = new URLSearchParams(hash.substring(1));
            const idFromUrl = params.get('proceso');

            if (idFromUrl) {
                // Si hay un ID en la URL, intentar cargarlo.
                setProcessId(idFromUrl); // Establecer el ID del estado
                try {
                    // *** DEPURACIÓN CRÍTICA AQUÍ ***
                    console.log("DEPURACIÓN: Realizando consulta a Supabase para cargar:");
                    console.log("DEPURACIÓN: idFromUrl:", idFromUrl, " (tipo:", typeof idFromUrl, ")");
                    console.log("DEPURACIÓN: userId:", userId, " (tipo:", typeof userId, ")");
                    // ********************************

                    const { data, error } = await supabase
                        .from('process_states')
                        .select('state_data')
                        .eq('id', idFromUrl)
                        .eq('user_id', userId)
                        .single();

                    if (error) { // Captura y loguea cualquier error de Supabase
                        console.error("DEPURACIÓN: Error de Supabase al cargar proceso:", error);
                        if (error.code !== 'PGRST116') { // 'PGRST116' es el código para "no row found"
                            throw error;
                        }
                    }

                    if (data && data.state_data) {
                        // Si se encuentra el estado guardado, restaurar todos los estados de la aplicación
                        const parsedState = data.state_data;

                        const buffer = arrayBufferDecode(parsedState.pdfOriginalBuffer);
                        setPdfOriginalBuffer(arrayBufferEncode(buffer)); // Actualiza el buffer para futuras firmas
                        const newFileBlob = new Blob([buffer], { type: 'application/pdf' });
                        
                        // Limpiar y luego establecer la URL del PDF y el selectedFile
                        if (fileUrl) URL.revokeObjectURL(fileUrl);
                        setFileUrl(URL.createObjectURL(newFileBlob)); 
                        setSelectedFile(newFileBlob); 

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
                        setShowSignatureBox3(parsedState.showSignatureBox3);

                        setErrorMessage('Proceso cargado desde URL exitosamente.');
                        setTimeout(() => setErrorMessage(''), 3000);
                    } else {
                        // Si el ID estaba en la URL pero no se encontró un estado guardado en Supabase,
                        // significa que el enlace puede ser viejo o inválido, o no pertenece a este usuario.
                        console.warn('ID en URL pero no hay proceso guardado en Supabase para este ID o no es tuyo. Iniciando un nuevo proceso.');
                        const newId = generateUniqueId(); // Generar un nuevo ID único
                        setProcessId(newId); // Establecer el nuevo ID
                        window.location.hash = `proceso=${newId}`; // Actualizar la URL con el nuevo ID
                        setErrorMessage('Proceso no encontrado o no autorizado. Iniciando uno nuevo.');
                        setTimeout(() => setErrorMessage(''), 5000);
                        // Limpiar estados del PDF para asegurar que el placeholder se ve.
                        setSelectedFile(null);
                        setPdfOriginalBuffer(null);
                        if (fileUrl) URL.revokeObjectURL(fileUrl);
                        setFileUrl(null);
                        setNumPages(null);
                        setPageNumber(1);
                        setScale(1.0);
                        pdfDocProxyRef.current = null;
                        setHasSignatureApplied(false);
                    }
                } catch (e) {
                    // Capturar errores durante la carga (problemas de red, datos corruptos, etc.)
                    console.error('Error al cargar proceso desde URL (posiblemente ID corrupto o problema de red/Supabase):', e);
                    setErrorMessage('Error al cargar proceso. Se iniciará uno nuevo.');
                    setTimeout(() => setErrorMessage(''), 5000);
                    const newId = generateUniqueId(); // Generar un nuevo ID para el nuevo proceso
                    setProcessId(newId);
                    window.location.hash = `proceso=${newId}`; // Actualizar la URL
                    // Limpiar estados del PDF para asegurar que el placeholder se ve.
                    setSelectedFile(null);
                    setPdfOriginalBuffer(null);
                    if (fileUrl) URL.revokeObjectURL(fileUrl);
                    setFileUrl(null);
                    setNumPages(null);
                    setPageNumber(1);
                    setScale(1.0);
                    pdfDocProxyRef.current = null;
                    setHasSignatureApplied(false);
                }
            } else {
                // Si no hay ningún ID en la URL al inicio, generar uno nuevo y establecerlo.
                const newId = generateUniqueId();
                setProcessId(newId);
                window.location.hash = `proceso=${newId}`; // Esto actualizará la URL en el navegador
                // Limpiar estados del PDF para asegurar que el placeholder se ve.
                setSelectedFile(null);
                setPdfOriginalBuffer(null);
                if (fileUrl) URL.revokeObjectURL(fileUrl);
                setFileUrl(null);
                setNumPages(null);
                setPageNumber(1);
                setScale(1.0);
                pdfDocProxyRef.current = null;
                setHasSignatureApplied(false);
            }
        };

        loadInitialProcess();

        // Limpieza de URL Blob al desmontar o al cambiar las dependencias.
        return () => {
            if (fileUrl) {
                URL.revokeObjectURL(fileUrl);
            }
        };
    }, [userId, fileUrl]); // Dependencias: userId para iniciar, fileUrl para limpieza de blobs.


    // Efecto para el posicionamiento inicial del recuadro de firma (Recuadro 1)
    useEffect(() => {
        if (!showSignatureBox1 || !viewerRef.current || !selectedFile || !pdfDocProxyRef.current) return;

        const handleInitialBoxPosition = async () => {
            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement || pdfPageElement.getBoundingClientRect().width === 0 || pdfPageElement.getBoundingClientRect().height === 0) {
                setTimeout(handleInitialBoxPosition, 200);
                return;
            }

            const pdfPageRect = pdfPageElement.getBoundingClientRect();
            const viewerRect = viewerRef.current.getBoundingClientRect();

            const scrollX = viewerRef.current.scrollLeft;
            const scrollY = viewerRef.current.scrollTop;

            const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
            const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;

            const defaultWidth = Math.min(signatureBox1Size.width, pdfPageRect.width * 0.8);
            const defaultHeight = Math.min(signatureBox1Size.height, pdfPageRect.height * 0.8);

            let initialX = pdfLeftInViewer + (pdfPageRect.width / 2) - (defaultWidth / 2);
            let initialY = pdfTopInViewer + (pdfPageRect.height / 2) - (defaultHeight / 2);

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

        const timer = setTimeout(() => {
            handleInitialBoxPosition();
        }, 100);

        return () => clearTimeout(timer);

    }, [
        showSignatureBox1,
        selectedFile,
        pageNumber,
        scale,
        pdfDocProxyRef,
        signatureBox1Size.width,
        signatureBox1Size.height
    ]);


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
                            sigCanvasRef.current.clear();
                            sigCanvasRef.current.on();
                        } else {
                            setTimeout(measureCanvasAreaAndInitialize, 50);
                        }
                    } else {
                        setTimeout(measureCanvasAreaAndInitialize, 50);
                    }
                } else {
                    setTimeout(measureCanvasAreaAndInitialize, 100);
                }
            }
        };

        const initialMeasureTimer = setTimeout(() => {
            measureCanvasAreaAndInitialize();
        }, 100);

        window.addEventListener('resize', measureCanvasAreaAndInitialize);

        return () => {
            clearTimeout(initialMeasureTimer);
            window.removeEventListener('resize', measureCanvasAreaAndInitialize);
        };
    }, [showSignatureBox3]);


    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        setErrorMessage('');
        // Limpiar todos los estados relacionados con el PDF antes de cargar el nuevo.
        setSelectedFile(null); 
        if (fileUrl) URL.revokeObjectURL(fileUrl);
        setFileUrl(null); 
        setNumPages(null);
        setPageNumber(1);
        setScale(1.0);
        pdfDocProxyRef.current = null;
        setPdfOriginalBuffer(null);
        setShowSignatureBox1(false);
        setShowSignatureBox2(false);
        setShowSignatureBox3(false);
        setSignatureBox1Pos({ x: 0, y: 0 });
        setSignatureBox1Size({ width: 200, height: 100 });
        setIsDraggingBox(false);
        setIsResizingBox(false);
        setHasSignatureApplied(false);
        setShowHelpModal(false);

        // Al cargar un nuevo archivo, SIEMPRE generamos un nuevo processId y actualizamos la URL.
        const newId = generateUniqueId();
        setProcessId(newId);
        window.location.hash = `proceso=${newId}`;
        
        if (file) {
            const MAX_FILE_SIZE_MB = 48;
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
                const buffer = await file.arrayBuffer();
                setPdfOriginalBuffer(arrayBufferEncode(buffer));
                const tempFileUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
                setFileUrl(tempFileUrl); // Establece el fileUrl
                setSelectedFile(file); // Establece selectedFile
                console.log('Archivo PDF válido seleccionado:', file.name, 'Tamaño:', file.size, 'bytes');
            } catch (error) {
                console.error('Error al cargar el PDF:', error);
                setErrorMessage('Error al cargar el PDF. Detalles en consola.');
            }
        }
    };

    const onDocumentLoadSuccess = ({ numPages: newNumPages, originalDocument }) => {
        setNumPages(newNumPages);
        if (pageNumber === 1 || pageNumber > newNumPages) {
            setPageNumber(1);
        }
        if (viewerRef.current) {
            viewerRef.current.scrollLeft = 0;
            viewerRef.current.scrollTop = 0;
        }
        pdfDocProxyRef.current = originalDocument;

        if (originalDocument && viewerRef.current) {
            originalDocument.getPage(1).then(page => {
                const viewport = page.getViewport({ scale: 1.0 });
                const viewerInnerWidth = viewerRef.current ? viewerRef.current.clientWidth - (15 * 2) : viewport.width;
                if (scale === 1.0) {
                    const initialScale = viewerInnerWidth / viewport.width;
                    setScale(Math.min(initialScale, 1.5));
                }
            }).catch(err => console.error("Error getting page for initial scale:", err));
        }
    };

    const goToNextPage = () => {
        setPageNumber((prevPageNumber) => Math.min(prevPageNumber + 1, numPages));
    };
    const goToPrevPage = () => {
        setPageNumber((prevPageNumber) => Math.max(prevPageNumber - 1, 1));
    };

    const handleMouseWheelZoom = (event) => {
        if (isDragging || isDraggingBox || isResizingBox) return;

        event.preventDefault();

        const delta = event.deltaY * -0.001;
        setScale((prevScale) => Math.max(0.5, Math.min(prevScale + delta, 3.0)));
    };

    const getPinchDistance = (touches) => {
        if (touches.length < 2) return null;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const getEventClientCoords = (e) => {
        if (e.touches && e.touches.length > 0) {
            return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
        }
        return { clientX: e.clientX, clientY: e.clientY };
    };

    const onStartInteraction = (e) => {
        if (e.target.closest('.signature-box-1') || e.target.closest('.signature-box-1-resize-handle') || e.target.closest('.signature-box-2') || e.target.closest('.signature-box-3-modal') || showHelpModal) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (viewerRef.current) {
            if (e.touches && e.touches.length === 2) {
                setIsDragging(false);
                const distance = getPinchDistance(e.touches);
                setInitialPinchDistance(distance);
                setInitialPinchScale(scale);
                console.log("Iniciando pellizco. Distancia inicial:", distance, "Escala inicial:", scale);
            } else if ((e.touches && e.touches.length === 1) || !e.touches) {
                setInitialPinchDistance(null);
                setIsDragging(true);
                const { clientX, clientY } = getEventClientCoords(e);
                setStartX(clientX - viewerRef.current.offsetLeft);
                setStartY(clientY - viewerRef.current.offsetTop);
                setScrollLeftInitial(viewerRef.current.scrollLeft);
                setScrollTopInitial(viewerRef.current.scrollTop);
                viewerRef.current.style.cursor = 'grabbing';
            }
        }
    };

    const onMoveInteraction = useCallback((e) => {
        if (!isDragging && !isResizingBox && !isDraggingBox && !initialPinchDistance) return;
        e.preventDefault();

        const { clientX, clientY } = getEventClientCoords(e);

        if (initialPinchDistance && e.touches && e.touches.length === 2) {
            const currentDistance = getPinchDistance(e.touches);
            if (currentDistance === null) return;

            const newScale = initialPinchScale * (currentDistance / initialPinchDistance);
            setScale(Math.max(0.5, Math.min(newScale, 3.0)));
        } else if (isDragging && ((e.touches && e.touches.length === 1) || !e.touches)) {
            if (viewerRef.current) {
                const x = clientX - viewerRef.current.offsetLeft;
                const y = clientY - viewerRef.current.offsetTop;
                const walkX = (x - startX);
                const walkY = (y - startY);
                viewerRef.current.scrollLeft = scrollLeftInitial - walkX;
                viewerRef.current.scrollTop = scrollTopInitial - walkY;
            }
        } else if (isResizingBox) {
            if (!initialBoxRect || !initialMousePos) {
                console.warn('initialBoxRect o initialMousePos es null en onMoveInteraction (redimensionamiento). Saltando.');
                return;
            }

            if (!viewerRef.current) return;
            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement) return;

            const pdfPageRect = pdfPageElement.getBoundingClientRect();
            const viewerRect = viewerRef.current.getBoundingClientRect();

            const scrollX = viewerRef.current.scrollLeft;
            const scrollY = viewerRef.current.scrollTop;

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

            const mouseDeltaX = mouseCurrentX - initialMousePos.x;
            const mouseDeltaY = mouseCurrentY - initialMousePos.y;

            const MIN_BOX_SIZE = 50;

            if (resizeHandleType === 'br') {
                newWidth = initialBoxRect.width + mouseDeltaX;
                newHeight = initialBoxRect.height + mouseDeltaY;
            } else if (resizeHandleType === 'bl') {
                newWidth = initialBoxRect.width - mouseDeltaX;
                newHeight = initialBoxRect.height + mouseDeltaY;
                newX = initialBoxRect.x + mouseDeltaX;
            }

            newWidth = Math.max(newWidth, MIN_BOX_SIZE);
            newHeight = Math.max(newHeight, MIN_BOX_SIZE);

            newX = Math.max(pdfLeftInViewer, newX);
            newY = Math.max(pdfTopInViewer, newY);

            newWidth = Math.min(newWidth, pdfRightInViewer - newX);
            newHeight = Math.min(newHeight, pdfBottomInViewer - newY);

            newWidth = Math.max(newWidth, MIN_BOX_SIZE);
            newHeight = Math.max(newHeight, MIN_BOX_SIZE);

            if (resizeHandleType === 'bl' && newWidth > initialBoxRect.width - mouseDeltaX) {
                newX = initialBoxRect.x - (newWidth - (initialBoxRect.width - mouseDeltaX));
                newX = Math.max(pdfLeftInViewer, newX);
            }

            setSignatureBox1Pos({ x: newX, y: newY });
            setSignatureBox1Size({ width: newWidth, height: newHeight });

        } else if (isDraggingBox) {
            if (!viewerRef.current) return;
            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement) return;

            const pdfPageRect = pdfPageElement.getBoundingClientRect();
            const viewerRect = viewerRef.current.getBoundingClientRect();

            const scrollX = viewerRef.current.scrollLeft;
            const scrollY = viewerRef.current.scrollTop;

            const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
            const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;
            const pdfRightInViewer = pdfLeftInViewer + pdfPageRect.width;
            const pdfBottomInViewer = pdfTopInViewer + pdfPageRect.height;

            const newX = (clientX - viewerRect.left) + scrollX - boxDragOffsetX;
            const newY = (clientY - viewerRect.top) + scrollY - boxDragOffsetY;

            let finalX = Math.max(pdfLeftInViewer, Math.min(newX, pdfRightInViewer - signatureBox1Size.width));
            let finalY = Math.max(pdfTopInViewer, Math.min(newY, pdfBottomInViewer - signatureBox1Size.height));

            setSignatureBox1Pos({ x: finalX, y: finalY });
        }
    }, [
        isDragging, isResizingBox, isDraggingBox, initialPinchDistance,
        startX, startY, scrollLeftInitial, scrollTopInitial, initialPinchScale,
        initialBoxRect, initialMousePos, resizeHandleType,
        signatureBox1Pos, // Eliminada advertencia de `useCallback`
        signatureBox1Size, boxDragOffsetX, boxDragOffsetY
    ]);

    const onEndInteraction = useCallback(() => {
        setIsDragging(false);
        setIsDraggingBox(false);
        setIsResizingBox(false);
        setResizeHandleType(null);
        setInitialMousePos(null);
        setInitialBoxRect(null);
        setInitialPinchDistance(null);

        if (viewerRef.current) {
            viewerRef.current.style.cursor = 'grab';
        }
    }, []);

    const onLeaveWindowGlobal = useCallback(() => {
        if (isDragging || isDraggingBox || isResizingBox || initialPinchDistance) {
            onEndInteraction();
        }
    }, [isDragging, isDraggingBox, isResizingBox, initialPinchDistance, onEndInteraction]);


    useEffect(() => {
        window.addEventListener('mouseup', onEndInteraction);
        window.addEventListener('mousemove', onMoveInteraction);
        window.addEventListener('mouseleave', onLeaveWindowGlobal);

        window.addEventListener('touchend', onEndInteraction); // <-- ¡CORREGIDO! Antes era onEndEventListener
        window.addEventListener('touchmove', onMoveInteraction, { passive: false });
        window.addEventListener('touchcancel', onEndInteraction);

        return () => {
            window.removeEventListener('mouseup', onEndInteraction);
            window.removeEventListener('mousemove', onMoveInteraction);
            window.removeEventListener('mouseleave', onLeaveWindowGlobal);

            window.removeEventListener('touchend', onEndInteraction); // <-- ¡CORREGIDO! Antes era onEndEventListener
            window.removeEventListener('touchmove', onMoveInteraction);
            window.removeEventListener('touchcancel', onEndInteraction);
        };
    }, [onEndInteraction, onMoveInteraction, onLeaveWindowGlobal]);


    const onSignatureBoxStart = (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (e.target.classList.contains('signature-box-1-resize-handle')) {
            return;
        }

        setIsDraggingBox(true);
        const { clientX, clientY } = getEventClientCoords(e);
        setBoxDragOffsetX(clientX - e.currentTarget.getBoundingClientRect().left);
        setBoxDragOffsetY(clientY - e.currentTarget.getBoundingClientRect().top);
        setInitialMousePos({ x: clientX, y: clientY });
        setInitialBoxRect({
            x: signatureBox1Pos.x,
            y: signatureBox1Pos.y,
            width: signatureBox1Size.width,
            height: signatureBox1Size.height,
        });
    };

    const onResizeHandleStart = (e, type) => {
        e.stopPropagation();
        e.preventDefault();
        setIsResizingBox(true);
        setResizeHandleType(type);
        const { clientX, clientY } = getEventClientCoords(e);
        setInitialBoxRect({
            x: signatureBox1Pos.x,
            y: signatureBox1Pos.y,
            width: signatureBox1Size.width,
            height: signatureBox1Size.height,
        });
        setInitialMousePos({ x: clientX, y: clientY });
    };


    const isProcessActive = showSignatureBox1 || showSignatureBox2 || showSignatureBox3 || showHelpModal;
    const isAddSignatureButtonDisabled = !selectedFile || errorMessage || isProcessActive;

    const handleAddSignatureClick = () => {
        if (isAddSignatureButtonDisabled) {
            setErrorMessage('Por favor, sube un PDF y/o finaliza el proceso de firma actual antes de añadir otra.');
            setTimeout(() => setErrorMessage(''), 3000);
            return;
        }
        setErrorMessage('');
        setShowSignatureBox1(true);
        setShowSignatureBox2(false);
        setShowSignatureBox3(false);
        setIsDraggingBox(false);
        setIsResizingBox(false);
    };

    const handleCancelSignatureBox1 = () => {
        setShowSignatureBox1(false);
    };
    const handleConfirmSignatureBox1 = () => {
        setFinalSignaturePos(signatureBox1Pos);
        setFinalSignatureSize(signatureBox1Size);
        setShowSignatureBox1(false);
        setShowSignatureBox2(true);
    };
    const handleCancelSignatureBox2 = () => {
        setShowSignatureBox2(false);
        setShowSignatureBox1(true);
    };
    const handleConfirmSignature2 = () => {
        setShowSignatureBox2(false);
        setShowSignatureBox3(true);
    };
    const handleCancelSignatureBox3 = () => {
        setShowSignatureBox3(false);
        setShowSignatureBox2(true);
        if (sigCanvasRef.current) {
            sigCanvasRef.current.clear();
        }
    };
    const handleClearSignature = () => {
        if (sigCanvasRef.current) {
            sigCanvasRef.current.clear();
        }
    };

    const handleConfirmSignature3 = async () => {
        if (sigCanvasRef.current && !sigCanvasRef.current.isEmpty()) {
            // La calidad 1.0 es el valor máximo para toDataURL para PNG (no aplica compresión).
            const signatureDataURL = sigCanvasRef.current.getTrimmedCanvas().toDataURL('image/png', 1.0); 
            console.log("DEPURACIÓN FIRMA: Signature Data URL MIME Type:", signatureDataURL.split(';')[0]); // Debería ser "data:image/png"
            console.log("DEPURACIÓN FIRMA: Signature Data URL start (first 50 chars):", signatureDataURL.substring(0, 50));

            setShowSignatureBox3(false);
            sigCanvasRef.current.clear();

            if (!pdfOriginalBuffer) {
                console.error('No hay un buffer de PDF (Base64) válido en el estado para incrustar la firma.');
                setErrorMessage('Error: Vuelve a cargar el PDF e intenta nuevamente. (Buffer Base64 no disponible).');
                return;
            }

            let pdfArrayBuffer;
            try {
                pdfArrayBuffer = arrayBufferDecode(pdfOriginalBuffer);
            } catch (error) {
                console.error('Error al decodificar el buffer Base64 del PDF:', error);
                setErrorMessage('Error: No se pudo preparar el PDF para la firma. Intenta cargarlo de nuevo.');
                return;
            }

            let pdfDoc; // Declarar pdfDoc aquí para que esté disponible en todo el bloque try/catch

            try {
                pdfDoc = await PDFDocument.load(pdfArrayBuffer); // Asignar aquí
                const signatureImage = await pdfDoc.embedPng(signatureDataURL); // Usamos embedPng explícitamente

                const pages = pdfDoc.getPages();
                if (pageNumber < 1 || pageNumber > pages.length) {
                    throw new Error(`Página ${pageNumber} fuera de rango. Total páginas: ${pages.length}`);
                }
                const currentPage = pages[pageNumber - 1];

                const pageSize = currentPage.getSize();
                const pdfNativeWidth = pageSize.width;
                const pdfNativeHeight = pageSize.height;

                const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
                if (!pdfPageElement) {
                    console.error("Elemento de página PDF no encontrado para cálculos de incrustación.");
                    setErrorMessage('Error: El visor de PDF no está listo para la incrustación.');
                    return;
                }
                const pdfPageRect = pdfPageElement.getBoundingClientRect();
                const viewerRect = viewerRef.current.getBoundingClientRect();

                const scrollX = viewerRef.current.scrollLeft;
                const scrollY = viewerRef.current.scrollTop;

                const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
                const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;

                const scaleX = pdfPageRect.width / pdfNativeWidth;
                const scaleY = pdfPageRect.height / pdfNativeHeight;

                const signatureXInPdfNative = (finalSignaturePos.x - pdfLeftInViewer) / scaleX;
                const signatureYInPdfNative = (finalSignaturePos.y - pdfTopInViewer) / scaleY;
                const signatureWidthInPdfNative = finalSignatureSize.width / scaleX;
                const signatureHeightInPdfNative = finalSignatureSize.height / scaleY;

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

                currentPage.drawImage(signatureImage, {
                    x: signatureXInPdfNative,
                    y: drawY,
                    width: signatureWidthInPdfNative,
                    height: signatureHeightInPdfNative,
                    opacity: 1,
                });

                const modifiedPdfBytes = await pdfDoc.save();
                const modifiedPdfBlob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });

                if (fileUrl) URL.revokeObjectURL(fileUrl);
                setFileUrl(URL.createObjectURL(modifiedPdfBlob));
                setSelectedFile(modifiedPdfBlob);

                setPdfOriginalBuffer(arrayBufferEncode(modifiedPdfBytes));

                setHasSignatureApplied(true);

                console.log('Firma incrustada exitosamente en el PDF.');
                setErrorMessage('Firma añadida exitosamente.');
                setTimeout(() => setErrorMessage(''), 3000);

            } catch (error) {
                console.error('Error al incrustar la firma:', error);
                setErrorMessage(`Error al incrustar la firma. Detalles: ${error.message}. ¿El PDF está protegido o hay un problema con las coordenadas?`);
                setShowSignatureBox2(true);
            }
        } else {
            console.warn('No se dibujó ninguna firma.');
            setErrorMessage('Por favor, dibuja una firma antes de confirmar.');
            setTimeout(() => setErrorMessage(''), 3000);
        }
    };

    const handleSavePdf = () => {
        if (fileUrl) {
            const a = document.createElement('a');
            a.href = fileUrl;
            const filename = selectedFile && selectedFile.name ?
                selectedFile.name.replace(/\.pdf$/, '_firmado.pdf') :
                'documento_firmado.pdf';
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setErrorMessage('PDF guardado exitosamente en tu dispositivo.');
            setTimeout(() => setErrorMessage(''), 3000);
        } else {
            setErrorMessage('No hay un PDF para guardar.');
            setTimeout(() => setErrorMessage(''), 3000);
        }
    };

    const handleSaveProcess = async () => {
        if (!selectedFile) {
            setErrorMessage('Carga un PDF antes de guardar el proceso.');
            setTimeout(() => setErrorMessage(''), 3000);
            return;
        }
        // Asegúrate de que processId y userId están presentes.
        // Si no hay processId, generamos uno nuevo. Esto puede pasar si el usuario no ha subido un PDF
        // pero de alguna manera el botón de guardar proceso no está deshabilitado.
        let idToSave = processId;
        if (!idToSave) {
            idToSave = generateUniqueId();
            setProcessId(idToSave); // Actualiza el estado para reflejar el nuevo ID
        }

        if (!userId) { // userId siempre debería existir a estas alturas.
            setErrorMessage('Error: ID de usuario no disponible. Intenta recargar la página.');
            setTimeout(() => setErrorMessage(''), 7000);
            return;
        }

        try {
            const processState = {
                pdfOriginalBuffer: pdfOriginalBuffer,
                numPages,
                pageNumber,
                scale,
                hasSignatureApplied,
                showSignatureBox1,
                signatureBox1Pos,
                signatureBox1Size,
                showSignatureBox2,
                finalSignaturePos,
                finalSignatureSize,
                showSignatureBox3: false
            };

            const { data, error } = await supabase
                .from('process_states')
                .upsert(
                    {
                        id: idToSave, // Usamos idToSave que ya tiene un valor garantizado
                        user_id: userId,
                        state_data: processState,
                    },
                    { onConflict: 'id' }
                );

            if (error) {
                throw error;
            }

            // Actualizar la URL del navegador con el processId guardado!
            const currentUrlHash = window.location.hash;
            if (currentUrlHash !== `#proceso=${idToSave}`) {
                window.location.hash = `proceso=${idToSave}`;
                console.log("URL actualizada con processId:", idToSave);
            } else {
                console.log("URL ya contiene el processId actual:", idToSave);
            }

            setErrorMessage('Proceso guardado con éxito en línea. Puedes compartir esta URL.');
            setTimeout(() => setErrorMessage(''), 5000);
        } catch (error) {
            console.error('Error al guardar el proceso en Supabase:', error);
            setErrorMessage(`Error al guardar el proceso: ${error.message}. Asegúrate que Supabase esté configurado y tengas conexión a internet.`);
            setTimeout(() => setErrorMessage(''), 7000);
        }
    };

    const handleShareButton = () => {
        if (!processId || !selectedFile) {
            setErrorMessage('Carga un PDF y guarda el proceso para obtener una URL compartible.');
            setTimeout(() => setErrorMessage(''), 4000);
            return;
        }
        const urlToCopy = `${window.location.origin}${window.location.pathname}#proceso=${processId}`;

        navigator.clipboard.writeText(urlToCopy)
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

    const handleOpenHelpModal = () => {
        setShowHelpModal(true);
    };

    const handleCloseHelpModal = () => {
        setShowHelpModal(false);
    };


    return (
        <div className="app-container">
            <header className="app-header">
                <h1 className="app-title">Página de Firmas y Visor de PDFs</h1>
            </header>

            <main className="app-main-content">
                <div className="top-control-panel">
                    <label htmlFor="pdf-upload" className="action-button select-file-button">
                        Seleccionar archivo
                    </label>
                    <input
                        type="file"
                        id="pdf-upload"
                        accept=".pdf,application/pdf"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />

                    {selectedFile ? (
                        <span className="file-status-text">
                            Archivo seleccionado: <strong>{selectedFile.name}</strong>
                        </span>
                    ) : (
                        <span className="file-status-text default-status">
                            Sin archivos cargados
                        </span>
                    )}

                    <button
                        className="action-button primary-action"
                        onClick={handleAddSignatureClick}
                        disabled={isAddSignatureButtonDisabled}
                    >
                        Añadir Firma ✍️
                    </button>

                    {hasSignatureApplied && (
                        <button
                            className="action-button primary-action emoji-add-button"
                            onClick={handleAddSignatureClick}
                            disabled={isAddSignatureButtonDisabled}
                            title="Añadir otra firma"
                        >
                            ➕
                        </button>
                    )}

                    <button
                        className="action-button"
                        onClick={handleSavePdf}
                        disabled={!selectedFile || isProcessActive}
                    >
                        Guardar 📁
                    </button>

                    <button
                        className="action-button save-process-button"
                        onClick={handleSaveProcess}
                        disabled={!selectedFile || showHelpModal || !processId || !userId}
                        title="Guarda el estado actual de tu trabajo (incluyendo el PDF y el recuadro de firma si está activo) en línea, asociándolo a esta URL única para lo que puedas continuar más tarde o compartirla."
                    >
                        Guardar Proceso 💾
                    </button>

                    <button
                        className="action-button"
                        onClick={handleShareButton}
                        disabled={!selectedFile || !processId || showHelpModal}
                        title="Copia la URL única de este proceso al portapapeles para compartirlo con otros."
                    >
                        Compartir 📤
                    </button>

                    <button
                        className="action-button help-button"
                        onClick={handleOpenHelpModal}
                        disabled={isProcessActive}
                    >
                        Cómo usar la página ❓
                    </button>

                    {numPages && (
                        <div className="pdf-top-navigation">
                            <button onClick={goToPrevPage} disabled={pageNumber <= 1 || isProcessActive}>⬅️ Anterior</button>
                            <span className="page-indicator">Página {pageNumber} de {numPages}</span>
                            <button onClick={goToNextPage} disabled={pageNumber >= numPages || isProcessActive}>Siguiente ➡️</button>
                        </div>
                    )}
                </div>

                {errorMessage && (
                    <p className="error-message">{errorMessage}</p>
                )}

                {fileUrl && !errorMessage ? (
                    <div className="pdf-viewer-container">
                        <div
                            className="pdf-document-wrapper"
                            onWheel={handleMouseWheelZoom}
                            ref={viewerRef}
                            onMouseDown={(e) => onStartInteraction(e)}
                            onTouchStart={(e) => onStartInteraction(e)}
                        >
                            <Document
                                key={fileUrl} 
                                file={fileUrl}
                                onLoadSuccess={onDocumentLoadSuccess}
                                onLoadError={console.error}
                                loading={<p style={{ color: '#8bbdff' }}>Cargando PDF...</p>}
                            >
                                <Page
                                    pageNumber={pageNumber}
                                    scale={scale}
                                    renderTextLayer={true}
                                    renderAnnotationLayer={true}
                                    className="pdf-page"
                                    width={600}
                                />
                            </Document>

                            <div className={`zoom-indicator ${isDragging || initialPinchDistance ? 'visible' : ''}`}>
                                Zoom: ${(scale * 100).toFixed(0)}%
                            </div>

                            {showSignatureBox1 && (
                                <div
                                    className={`signature-box-1 ${isDraggingBox ? 'is-dragging' : ''} ${isResizingBox ? 'is-resizing' : ''}`}
                                    style={{
                                        left: signatureBox1Pos.x + 'px',
                                        top: signatureBox1Pos.y + 'px',
                                        width: signatureBox1Size.width + 'px',
                                        height: signatureBox1Size.height + 'px',
                                    }}
                                    onMouseDown={(e) => onSignatureBoxStart(e)}
                                    onTouchStart={(e) => onSignatureBoxStart(e)}
                                >
                                    <div className="signature-box-1-buttons">
                                        <button className="signature-box-1-button cancel-button" onClick={handleCancelSignatureBox1}>❌</button>
                                        <button className="signature-box-1-button confirm-button" onClick={handleConfirmSignatureBox1}>✅</button>
                                    </div>
                                    <div
                                        className="signature-box-1-resize-handle bottom-right"
                                        onMouseDown={(e) => onResizeHandleStart(e, 'br')}
                                        onTouchStart={(e) => onResizeHandleStart(e, 'br')}
                                    ></div>
                                    <div
                                        className="signature-box-1-resize-handle bottom-left"
                                        onMouseDown={(e) => onResizeHandleStart(e, 'bl')}
                                        onTouchStart={(e) => onResizeHandleStart(e, 'bl')}
                                    ></div>
                                </div>
                            )}

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
                    <div className="no-pdf-placeholder">
                        {!errorMessage && <p>Sube un PDF para empezar a trabajar con él.</p>}
                    </div>
                )}
            </main>

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
                                    // Propiedad para fondo transparente
                                    backgroundColor: 'transparent'
                                }}
                                penColor='black'
                                minWidth={1}
                                maxWidth={2}
                                dotSize={0.5} // Mejora la continuidad del trazo
                                velocityFilterWeight={0.9} // Suaviza el trazo
                                minDistance={0.1} // Asegura más puntos en el trazo para nitidez
                                onBegin={() => setErrorMessage('')}
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