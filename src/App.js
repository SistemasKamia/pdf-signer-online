import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import SignatureCanvas from 'react-signature-canvas';
import { PDFDocument } from 'pdf-lib';
import { decode as arrayBufferDecode, encode as arrayBufferEncode } from 'base64-arraybuffer';

// *********************************************************************************
// ¡SOLUCIÓN FINAL Y MÁS ROBUSTA PARA EL WORKER CON LA VERSIÓN ESPECÍFICA DETECTADA EN CONSOLA!
// Apuntamos a la versión 3.11.174 de pdf.worker.min.js en CDNJS.
// *********************************************************************************
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

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

  // NUEVO ESTADO: Para controlar si ya se ha añadido al menos una firma exitosamente
  const [hasSignatureApplied, setHasSignatureApplied] = useState(false);
  // NUEVO ESTADO: Para controlar la visibilidad del modal de ayuda
  const [showHelpModal, setShowHelpModal] = useState(false);


  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!showSignatureBox1 || !viewerRef.current || !selectedFile) return;

    const handleInitialBoxPosition = () => {
      const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
      if (!pdfPageElement) {
        console.warn('PDF Page element not found for initial box position calculation.');
        return;
      }

      const pdfPageRect = pdfPageElement.getBoundingClientRect();
      const viewerRect = viewerRef.current.getBoundingClientRect();

      if (pdfPageRect.width === 0 || pdfPageRect.height === 0) {
        console.warn('PDF Page has zero width/height. Retrying position calculation for signature box...');
        setTimeout(handleInitialBoxPosition, 200);
        return;
      }

      const scrollX = viewerRef.current.scrollLeft;
      const scrollY = viewerRef.current.scrollTop;

      const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + scrollX;
      const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + scrollY;
      const pdfRightInViewer = pdfLeftInViewer + pdfPageRect.width;
      const pdfBottomInViewer = pdfTopInViewer + pdfPageRect.height; // Corregido 'pdfPageInViewer' a 'pdfPageRect'

      const defaultWidth = signatureBox1Size.width;
      const defaultHeight = signatureBox1Size.height;

      let initialX = pdfLeftInViewer + (pdfPageRect.width / 2) - (defaultWidth / 2);
      let initialY = pdfTopInViewer + (pdfPageRect.height / 2) - (defaultHeight / 2);

      // CORRECCIÓN: Usar pdfTopInViewer para el límite inferior de Y para que no se salga
      initialX = Math.max(pdfLeftInViewer, Math.min(initialX, pdfRightInViewer - defaultWidth));
      initialY = Math.max(pdfTopInViewer, Math.min(initialY, pdfBottomInViewer - defaultHeight));

      setSignatureBox1Pos({ x: initialX, y: initialY });

      console.log('Recuadro 1 posicionado:', {
        pdfPageRect, viewerRect, scrollX, scrollY,
        pdfLeftInViewer: pdfLeftInViewer.toFixed(0), pdfTopInViewer: pdfTopInViewer.toFixed(0),
        initialX: initialX.toFixed(0), initialY: initialY.toFixed(0)
      });
    };

    const interval = setInterval(() => {
        if (viewerRef.current && viewerRef.current.querySelector('.react-pdf__Page') && viewerRef.current.querySelector('.react-pdf__Page').getBoundingClientRect().width > 0) {
            clearInterval(interval);
            handleInitialBoxPosition();
        }
    }, 50);

    return () => clearInterval(interval);

  }, [showSignatureBox1, selectedFile, numPages, pageNumber, scale, signatureBox1Size.width, signatureBox1Size.height]);

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
              console.warn("sigCanvasRef.current.canvas no está listo, reintentando...");
              setTimeout(measureCanvasAreaAndInitialize, 50);
            }
          } else {
            console.warn("sigCanvasRef.current no está listo, reintentando...");
            setTimeout(measureCanvasAreaAndInitialize, 50);
          }
        } else {
          console.warn("Área de canvas de firma tiene dimensiones cero, reintentando medida...");
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
    setSelectedFile(null);
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
    // NUEVO: Reinicia el estado de firma aplicada al cargar un nuevo PDF
    setHasSignatureApplied(false);
    // NUEVO: Ocultar el modal de ayuda al cargar un nuevo archivo
    setShowHelpModal(false);

    if (file) {
      const MAX_FILE_SIZE_MB = 48;
      const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

      if (file.type !== 'application/pdf') {
        setErrorMessage('Error: Por favor, selecciona un archivo PDF.');
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setErrorMessage(`Error: El archivo es demasiado grande. Máximo ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        setPdfOriginalBuffer(arrayBufferEncode(buffer));
        setSelectedFile(file);
        setFileUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' })));
        console.log('Archivo PDF válido seleccionado:', file.name, 'Tamaño:', file.size, 'bytes');
      } catch (error) {
        console.error('Error al cargar el PDF:', error);
        setErrorMessage('Error al cargar el PDF. Detalles en consola.');
      }
    }
  };

  const onDocumentLoadSuccess = ({ numPages: newNumPages, originalDocument }) => {
    setNumPages(newNumPages);
    setPageNumber(1);
    if (viewerRef.current) {
      viewerRef.current.scrollLeft = 0;
      viewerRef.current.scrollTop = 0;
    }
    pdfDocProxyRef.current = originalDocument;
    if (originalDocument && viewerRef.current) {
        originalDocument.getPage(1).then(page => {
            const viewport = page.getViewport({ scale: 1.0 });
            const viewerInnerWidth = viewerRef.current ? viewerRef.current.clientWidth - (15 * 2) : viewport.width;
            const initialScale = viewerInnerWidth / viewport.width;
            setScale(Math.min(initialScale, 1.5));
        }).catch(err => console.error("Error getting page for initial scale:", err));
    }
  };

  const goToNextPage = () => {
    setPageNumber((prevPageNumber) => Math.min(prevPageNumber + 1, numPages));
  };

  const goToPrevPage = () => {
    setPageNumber((prevPageNumber) => Math.max(prevPageNumber - 1, 1));
  };

  const handleZoom = (event) => {
    event.preventDefault();
    const delta = event.deltaY * -0.001;
    setScale((prevScale) => Math.max(0.5, Math.min(prevScale + delta, 3.0)));
  };

  const onMouseDownPDFViewer = (e) => {
    if (e.target.closest('.signature-box-1') || e.target.closest('.signature-box-1-resize-handle') || e.target.closest('.signature-box-2') || e.target.closest('.signature-box-3-modal') || showHelpModal) { // Evita arrastrar si el modal de ayuda está abierto
      return;
    }
    if (viewerRef.current) {
      setIsDragging(true);
      setStartX(e.pageX - viewerRef.current.offsetLeft);
      setStartY(e.pageY - viewerRef.current.offsetTop);
      setScrollLeftInitial(viewerRef.current.scrollLeft);
      setScrollTopInitial(viewerRef.current.scrollTop);
      viewerRef.current.style.cursor = 'grabbing';
    }
  };

  const onMouseMoveGlobal = useCallback((e) => {
    if (!isDragging && !isResizingBox && !isDraggingBox) return;
    e.preventDefault();
    if (isDragging) {
      if (viewerRef.current) {
        const x = e.pageX - viewerRef.current.offsetLeft;
        const y = e.pageY - viewerRef.current.offsetTop;
        const walkX = (x - startX);
        const walkY = (y - startY);
        viewerRef.current.scrollLeft = scrollLeftInitial - walkX;
        viewerRef.current.scrollTop = scrollTopInitial - walkY;
      }
    } else if (isResizingBox) {
      // CORRECCIÓN: Añadir verificación para `initialBoxRect` y `initialMousePos`
      // antes de usarlos en redimensionamiento
      if (!initialBoxRect || !initialMousePos) {
          console.warn('initialBoxRect o initialMousePos es null en onMouseMoveGlobal (redimensionamiento). Saltando.');
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

      const mouseCurrentX = e.clientX;
      const mouseCurrentY = e.clientY;

      let newWidth = initialBoxRect.width;
      let newHeight = initialBoxRect.height;

      const mouseDeltaX = mouseCurrentX - initialMousePos.x;
      const mouseDeltaY = mouseCurrentY - initialMousePos.y;

      const MIN_BOX_SIZE = 50;

      let currentSignatureBox1Pos = { ...signatureBox1Pos };

      if (resizeHandleType === 'br') {
        newWidth = initialBoxRect.width + mouseDeltaX;
        newHeight = initialBoxRect.height + mouseDeltaY;
      } else if (resizeHandleType === 'bl') {
        newWidth = initialBoxRect.width - mouseDeltaX;
        newHeight = initialBoxRect.height + mouseDeltaY;
        currentSignatureBox1Pos.x = initialBoxRect.x + mouseDeltaX;
      }

      newWidth = Math.max(newWidth, MIN_BOX_SIZE);
      newHeight = Math.max(newHeight, MIN_BOX_SIZE);

      currentSignatureBox1Pos.x = Math.max(pdfLeftInViewer, Math.min(currentSignatureBox1Pos.x, pdfRightInViewer - newWidth));
      currentSignatureBox1Pos.y = Math.max(pdfTopInViewer, Math.min(currentSignatureBox1Pos.y, pdfBottomInViewer - newHeight));

      newWidth = Math.min(newWidth, pdfRightInViewer - currentSignatureBox1Pos.x);
      newHeight = Math.min(newHeight, pdfBottomInViewer - currentSignatureBox1Pos.y);

      newWidth = Math.max(newWidth, MIN_BOX_SIZE);
      newHeight = Math.max(newHeight, MIN_BOX_SIZE);

      setSignatureBox1Pos(currentSignatureBox1Pos);
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

      const newX = (e.clientX - viewerRect.left) + scrollX - boxDragOffsetX;
      const newY = (e.clientY - viewerRect.top) + scrollY - boxDragOffsetY;

      let finalX = Math.max(pdfLeftInViewer, Math.min(newX, pdfRightInViewer - signatureBox1Size.width));
      let finalY = Math.max(pdfTopInViewer, Math.min(newY, pdfBottomInViewer - signatureBox1Size.height));

      setSignatureBox1Pos({ x: finalX, y: finalY });
    }
  }, [
    isDragging, isResizingBox, isDraggingBox,
    startX, startY, scrollLeftInitial, scrollTopInitial,
    initialBoxRect, initialMousePos, resizeHandleType, // initialBoxRect y initialMousePos en dependencias
    signatureBox1Pos, signatureBox1Size, boxDragOffsetX, boxDragOffsetY
  ]);


  const onMouseUpGlobal = useCallback(() => {
    setIsDragging(false);
    setIsDraggingBox(false);
    setIsResizingBox(false);
    setResizeHandleType(null);
    // CORRECCIÓN: Resetear initialMousePos y initialBoxRect al soltar el ratón
    setInitialMousePos(null);
    setInitialBoxRect(null);

    if (viewerRef.current) {
      viewerRef.current.style.cursor = 'grab';
    }
  }, []);

  const onMouseLeaveGlobal = useCallback(() => {
    if (isDragging || isDraggingBox || isResizingBox) {
      onMouseUpGlobal();
    }
  }, [isDragging, isDraggingBox, isResizingBox, onMouseUpGlobal]);


  useEffect(() => {
    window.addEventListener('mouseup', onMouseUpGlobal);
    window.addEventListener('mousemove', onMouseMoveGlobal);
    window.addEventListener('mouseleave', onMouseLeaveGlobal);
    return () => {
      window.removeEventListener('mouseup', onMouseUpGlobal);
      window.removeEventListener('mousemove', onMouseMoveGlobal);
      window.removeEventListener('mouseleave', onMouseLeaveGlobal);
    };
  }, [onMouseUpGlobal, onMouseMoveGlobal, onMouseLeaveGlobal]);

  const onSignatureBoxMouseDown = (e) => {
    e.stopPropagation();

    if (e.target.classList.contains('signature-box-1-resize-handle')) {
        return;
    }

    setIsDraggingBox(true);
    setBoxDragOffsetX(e.clientX - e.currentTarget.getBoundingClientRect().left);
    setBoxDragOffsetY(e.clientY - e.currentTarget.getBoundingClientRect().top);
    // CORRECCIÓN: Establecer initialMousePos y initialBoxRect al iniciar el arrastre de la caja
    setInitialMousePos({ x: e.clientX, y: e.clientY });
    setInitialBoxRect({
      x: signatureBox1Pos.x,
      y: signatureBox1Pos.y,
      width: signatureBox1Size.width,
      height: signatureBox1Size.height,
    });
  };

  const onResizeHandleMouseDown = (e, type) => {
    e.stopPropagation();
    setIsResizingBox(true);
    setResizeHandleType(type);
    setInitialBoxRect({
      x: signatureBox1Pos.x,
      y: signatureBox1Pos.y,
      width: signatureBox1Size.width,
      height: signatureBox1Size.height,
    });
    setInitialMousePos({ x: e.clientX, y: e.clientY });
  };

  // Función para deshabilitar los botones de añadir firma si un proceso de firma está activo
  const isAddSignatureButtonDisabled = !selectedFile || errorMessage || showSignatureBox1 || showSignatureBox2 || showSignatureBox3;

  const handleAddSignatureClick = () => {
    if (isAddSignatureButtonDisabled) { // Usamos la variable de control de deshabilitación
      setErrorMessage('Por favor, sube un PDF y/o finaliza el proceso de firma actual antes de añadir otra.');
      setTimeout(() => setErrorMessage(''), 3000); // Limpiar mensaje después de 3 segundos
      return;
    }
    setErrorMessage('');
    setShowSignatureBox1(true);
    setShowSignatureBox2(false);
    setShowSignatureBox3(false);
    setSignatureBox1Pos({ x: 0, y: 0 });
    setSignatureBox1Size({ width: 200, height: 100 });
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
        const signatureDataURL = sigCanvasRef.current.toDataURL('image/png');

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

        try {
            const pdfDoc = await PDFDocument.load(pdfArrayBuffer);
            const signatureImage = await pdfDoc.embedPng(signatureDataURL);

            const pages = pdfDoc.getPages();
            const currentPage = pages[pageNumber - 1]; // Asegúrate de que pageNumber sea válido aquí

            const pageSize = currentPage.getSize(); // pdf-lib proporciona width y height
            const pdfNativeWidth = pageSize.width;
            const pdfNativeHeight = pageSize.height;

            const pdfPageElement = viewerRef.current.querySelector('.react-pdf__Page');
            if (!pdfPageElement) {
                console.error("Elemento de página PDF no encontrado para cálculos de incrustación.");
                setErrorMessage('Error: El visor de PDF no está listo para la incrustación.');
                return;
            }
            const pdfPageRect = pdfPageElement.getBoundingClientRect();

            const currentPdfScaleX = pdfPageRect.width / pdfNativeWidth;
            const currentPdfScaleY = pdfPageRect.height / pdfNativeHeight;

            const viewerRect = viewerRef.current.getBoundingClientRect();
            const pdfLeftInViewer = (pdfPageRect.left - viewerRect.left) + viewerRef.current.scrollLeft;
            const pdfTopInViewer = (pdfPageRect.top - viewerRect.top) + viewerRef.current.scrollTop;

            const signatureXInPdfNative = (finalSignaturePos.x - pdfLeftInViewer) / currentPdfScaleX;
            const signatureYInPdfNative = (finalSignaturePos.y - pdfTopInViewer) / currentPdfScaleY;

            const signatureWidthInPdfNative = finalSignatureSize.width / currentPdfScaleX;
            const signatureHeightInPdfNative = finalSignatureSize.height / currentPdfScaleY;

            const drawY = pdfNativeHeight - (signatureYInPdfNative + signatureHeightInPdfNative);

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
            setSelectedFile(modifiedPdfBlob); // Actualizar selectedFile para que represente el PDF modificado

            setPdfOriginalBuffer(arrayBufferEncode(modifiedPdfBytes));

            // NUEVO: Marcar que al menos una firma ha sido aplicada exitosamente
            setHasSignatureApplied(true);

            console.log('Firma incrustada exitosamente en el PDF.');
            setErrorMessage('Firma añadida exitosamente.');
            setTimeout(() => setErrorMessage(''), 3000);

        } catch (error) {
            console.error('Error al incrustar la firma:', error);
            setErrorMessage(`Error al incrustar la firma. Detalles: ${error.message}. ¿El PDF está protegido o hay un problema con las coordenadas?`);
            setShowSignatureBox2(true); // Si falla, regresa a la caja de confirmación para reintentar
        }
    } else {
        console.warn('No se dibujó ninguna firma.');
        setErrorMessage('Por favor, dibuja una firma antes de confirmar.');
        setTimeout(() => setErrorMessage(''), 3000);
    }
  };

  // NUEVA FUNCIÓN: Para guardar el PDF actual
  const handleSavePdf = () => {
    if (fileUrl) {
      const a = document.createElement('a');
      a.href = fileUrl;
      // Intenta usar el nombre original del archivo si está disponible, si no, uno genérico.
      const filename = selectedFile && selectedFile.name ?
                       selectedFile.name.replace(/\.pdf$/, '_firmado.pdf') :
                       'documento_firmado.pdf';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setErrorMessage('PDF guardado exitosamente.');
      setTimeout(() => setErrorMessage(''), 3000);
    } else {
      setErrorMessage('No hay un PDF para guardar.');
      setTimeout(() => setErrorMessage(''), 3000);
    }
  };

  // NUEVA FUNCIÓN: Para abrir el modal de ayuda
  const handleOpenHelpModal = () => {
    setShowHelpModal(true);
  };

  // NUEVA FUNCIÓN: Para cerrar el modal de ayuda
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

          {/* Botón original de Añadir Firma */}
          <button
            className="action-button primary-action"
            onClick={handleAddSignatureClick}
            disabled={isAddSignatureButtonDisabled}
          >
            Añadir Firma ✍️
          </button>

          {/* NUEVO BOTÓN: Añadir Firma (solo emoji), visible después de la primera firma */}
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

          {/* Botón Guardar - AHORA HABILITADO CUANDO HAY UN ARCHIVO */}
          <button
            className="action-button"
            onClick={handleSavePdf}
            disabled={!selectedFile || showSignatureBox1 || showSignatureBox2 || showSignatureBox3 || showHelpModal} // Deshabilitado si no hay archivo o si un proceso de firma está activo o el modal de ayuda abierto
          >
            Guardar 📁
          </button>
          <button className="action-button" disabled={showHelpModal}>Compartir 📤</button> {/* Deshabilitar si el modal de ayuda está abierto */}
          <button className="action-button help-button" onClick={handleOpenHelpModal} disabled={showSignatureBox1 || showSignatureBox2 || showSignatureBox3}>Cómo usar la página ❓</button> {/* Deshabilitar si hay un proceso de firma activo */}

          {numPages && (
            <div className="pdf-top-navigation">
              <button onClick={goToPrevPage} disabled={pageNumber <= 1 || showHelpModal}>⬅️ Anterior</button> {/* Deshabilitar si el modal de ayuda está abierto */}
              <span className="page-indicator">Página {pageNumber} de {numPages}</span>
              <button onClick={goToNextPage} disabled={pageNumber >= numPages || showHelpModal}>Siguiente ➡️</button> {/* Deshabilitar si el modal de ayuda está abierto */}
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
              onWheel={handleZoom}
              ref={viewerRef}
              onMouseDown={onMouseDownPDFViewer}
            >
              <Document
                file={fileUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={console.error}
                loading={<p style={{color: '#8bbdff'}}>Cargando PDF...</p>}
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

              {/* RECUADRO 1: El recuadro de selección de firma (movible y redimensionable) */}
              {showSignatureBox1 && (
                <div
                  className="signature-box-1"
                  style={{
                    left: signatureBox1Pos.x + 'px',
                    top: signatureBox1Pos.y + 'px',
                    width: signatureBox1Size.width + 'px',
                    height: signatureBox1Size.height + 'px',
                  }}
                  onMouseDown={onSignatureBoxMouseDown}
                >
                  <div className="signature-box-1-buttons">
                    <button className="signature-box-1-button cancel-button" onClick={handleCancelSignatureBox1}>❌</button>
                    <button className="signature-box-1-button confirm-button" onClick={handleConfirmSignatureBox1}>✅</button>
                  </div>
                  {/* Handles de redimensionamiento */}
                  <div
                    className="signature-box-1-resize-handle bottom-right"
                    onMouseDown={(e) => onResizeHandleMouseDown(e, 'br')}
                  ></div>
                  <div
                    className="signature-box-1-resize-handle bottom-left"
                    onMouseDown={(e) => onResizeHandleMouseDown(e, 'bl')}
                  ></div>
                </div>
              )}

              {/* RECUADRO 2: Confirmación de área (estático) */}
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

            {/* Indicador de Zoom */}
            <div className="zoom-indicator">
              Zoom: {(scale * 100).toFixed(0)}%
            </div>

          </div>
        ) : (
            // Texto o imagen cuando no hay PDF cargado o hay un error
            <div className="no-pdf-placeholder">
              {!errorMessage && <p>Sube un PDF para empezar a trabajar con él.</p>}
            </div>
        )}
      </main>

      {/* MODAL DEL RECUADRO 3: RENDERIZADO FUERA DEL VISOR DEL PDF */}
      {showSignatureBox3 && (
        <div className="modal-overlay">
          <div
            className="signature-box-3-modal"
            ref={modalCanvasDrawingAreaRef}
          >
            <h2>Dibuja tu firma</h2> {/* Título añadido para claridad en el modal */}
            <div className="signature-box-3-drawing-area"> {/* Nuevo div para contener el canvas */}
              <SignatureCanvas
                ref={sigCanvasRef}
                canvasProps={{
                  className: 'signature-canvas-modal',
                  width: sigCanvasWidth, // Pasar ancho medido
                  height: sigCanvasHeight, // Pasar alto medido
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

      {/* NUEVO MODAL DE AYUDA */}
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
              <li>**Compartir 📤:** (Funcionalidad no implementada, futura mejora).</li>
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