import React, { useState, useCallback, useRef, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

// --- Constants ---
const ItemTypes = {
  FIELD: 'field',
};

// --- Draggable Field Component (for the sidebar) ---
const DraggableField = ({ type, label, disabled }) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.FIELD,
    item: { type },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }));

  return (
    <div
      ref={drag}
      className={`p-3 mb-3 border-2 border-dashed rounded-lg text-center transition-all ${
        disabled 
          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
          : `cursor-move ${isDragging ? 'border-blue-500 bg-blue-100 opacity-50' : 'border-gray-300 bg-white hover:bg-gray-50'}`
      }`}
    >
      {label}
    </div>
  );
};

// --- Placed Field Component (the item on the PDF) ---
const PlacedField = ({ id, left, top, type, assignedTo, onAssign, allFillers }) => {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: ItemTypes.FIELD,
        item: { id, left, top, type },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    }), [id, left, top, type]);

    const fieldStyle = {
        left: `${left}%`,
        top: `${top}%`,
        position: 'absolute',
        opacity: isDragging ? 0.5 : 1,
        zIndex: 10,
    };

    const getBackgroundColor = () => {
        if (!assignedTo) return 'bg-yellow-200 border-yellow-500';
        const colors = ['bg-pink-200 border-pink-500', 'bg-purple-200 border-purple-500', 'bg-green-200 border-green-500', 'bg-indigo-200 border-indigo-500'];
        const fillerIndex = allFillers.findIndex(f => f.id === assignedTo);
        return colors[fillerIndex % colors.length] || 'bg-gray-200 border-gray-500';
    };

    return (
        <div ref={drag} style={fieldStyle} className={`p-2 border-2 rounded-md cursor-move text-sm transform ${getBackgroundColor()}`}>
            <p className="font-semibold">{type}</p>
            <select
                value={assignedTo || ''}
                onChange={(e) => onAssign(id, e.target.value)}
                className="mt-1 w-full text-xs rounded border-gray-300"
                onClick={(e) => e.stopPropagation()} // Prevent drag from starting on select click
            >
                <option value="">Unassigned</option>
                {allFillers.map(filler => (
                    <option key={filler.id} value={filler.id}>{filler.email}</option>
                ))}
            </select>
        </div>
    );
};


// --- PDF Page Component ---
const PdfPage = ({ pageNum, pdf, onDrop, placedFields, onMoveField, onAssignField, allFillers }) => {
  const canvasRef = useRef(null);
  const dropRef = useRef(null);
  
  const renderPage = useCallback(async () => {
      if (!pdf || !canvasRef.current || !dropRef.current) return;
      const page = await pdf.getPage(pageNum);
      
      const container = dropRef.current;
      const { width } = container.getBoundingClientRect();
      if (width === 0) return; // Don't render if container has no width yet
      
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = width / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      canvas.height = scaledViewport.height;
      canvas.width = width;
      container.style.height = `${scaledViewport.height}px`;

      const renderContext = {
        canvasContext: context,
        viewport: scaledViewport,
      };
      page.render(renderContext);
  }, [pdf, pageNum]);

  useEffect(() => {
    renderPage();
    
    // Use a ResizeObserver to re-render the PDF page when the container size changes
    const resizeObserver = new ResizeObserver(() => renderPage());
    const container = dropRef.current;
    if (container) {
        resizeObserver.observe(container);
    }
    
    return () => {
        if (container) {
            resizeObserver.unobserve(container);
        }
    };
  }, [renderPage]);

  const [, drop] = useDrop(() => ({
    accept: ItemTypes.FIELD,
    drop: (item, monitor) => {
        if (!dropRef.current) return;
        const dropTargetRect = dropRef.current.getBoundingClientRect();

        if (item.id !== undefined) {
            // This is a MOVE operation for an existing field.
            // Use the delta to make the move precise relative to the initial grab point.
            const delta = monitor.getDifferenceFromInitialOffset();
            if (!delta) return;

            const deltaX_percent = (delta.x / dropTargetRect.width) * 100;
            const deltaY_percent = (delta.y / dropTargetRect.height) * 100;

            let newLeft = item.left + deltaX_percent;
            let newTop = item.top + deltaY_percent;
            
            // Constrain to bounds of the drop target
            newLeft = Math.max(0, Math.min(100, newLeft));
            newTop = Math.max(0, Math.min(100, newTop));
            
            onMoveField(item.id, newLeft, newTop);

        } else {
            // This is a NEW drop from the sidebar.
            // Place the top-left corner at the cursor's final position.
            const offset = monitor.getClientOffset();
            if (!offset) return;
            
            const left = Math.max(0, Math.min(100, ((offset.x - dropTargetRect.left) / dropTargetRect.width) * 100));
            const top = Math.max(0, Math.min(100, ((offset.y - dropTargetRect.top) / dropTargetRect.height) * 100));
            
            onDrop(item.type, pageNum, left, top);
        }
    },
  }), [onDrop, onMoveField, pageNum]);

  drop(dropRef);

  return (
    <div ref={dropRef} className="relative border-2 border-gray-300 shadow-lg mb-8" style={{ width: '100%' }}>
      <canvas ref={canvasRef} />
      <div className="absolute top-0 left-0 w-full h-full">
        {placedFields.map((field) => (
          <PlacedField key={field.id} {...field} onAssign={onAssignField} allFillers={allFillers} />
        ))}
      </div>
    </div>
  );
};


// --- Main App Component ---
export default function App() {
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [placedFields, setPlacedFields] = useState([]);
  const [fillers, setFillers] = useState([]);
  const [newFillerEmail, setNewFillerEmail] = useState('');
  const [nextId, setNextId] = useState(0);
  const [isPdfJsReady, setIsPdfJsReady] = useState(false);
  const fileInputRef = useRef(null);

  // Dynamically load pdf.js to avoid bundler issues
  useEffect(() => {
    // Check if the script is already loaded
    if (window.pdfjsLib) {
      setIsPdfJsReady(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    
    script.onload = () => {
      // Set the worker source for pdf.js
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
      setIsPdfJsReady(true);
    };

    document.body.appendChild(script);

    return () => {
      // Clean up the script when the component unmounts
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const onFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf' && window.pdfjsLib) {
      const fileReader = new FileReader();
      fileReader.onload = async (e) => {
        const typedarray = new Uint8Array(e.target.result);
        const loadingTask = window.pdfjsLib.getDocument(typedarray);
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
        // Reset state for new document
        setPlacedFields([]); 
        setFillers([]); 
        setNewFillerEmail('');
        setNextId(0);
      };
      fileReader.readAsArrayBuffer(file);
    }
  };

  const addFiller = () => {
    if (newFillerEmail && /\S+@\S+\.\S+/.test(newFillerEmail) && !fillers.some(f => f.email === newFillerEmail)) {
        const newFiller = { id: `filler_${Date.now()}`, email: newFillerEmail };
        setFillers([...fillers, newFiller]);
        setNewFillerEmail('');
    }
  };

  const removeFiller = (id) => {
      setFillers(fillers.filter(f => f.id !== id));
      // Unassign fields that were linked to the removed filler
      setPlacedFields(placedFields.map(f => f.assignedTo === id ? { ...f, assignedTo: null } : f));
  };

  const handleDrop = useCallback((type, pageNum, left, top) => {
    setPlacedFields((prev) => [
      ...prev,
      { id: nextId, pageNum, left, top, type, assignedTo: null },
    ]);
    setNextId(prev => prev + 1);
  }, [nextId]);

  const handleMoveField = useCallback((id, left, top) => {
    setPlacedFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, left, top } : field))
    );
  }, []);
  
  const handleAssignField = (fieldId, fillerId) => {
    setPlacedFields(fields => fields.map(field => 
        field.id === fieldId ? { ...field, assignedTo: fillerId || null } : field
    ));
  };

  const handleSend = () => {
      // ** BACKEND INTEGRATION POINT **
      const isAnyFieldUnassigned = placedFields.some(field => !field.assignedTo);
      if (placedFields.length === 0) {
          alert("Please place at least one field on the document.");
          return;
      }
      if (isAnyFieldUnassigned) {
          alert("Please assign all placed fields to a filler.");
          return;
      }
      if (fillers.length === 0) {
          alert("Please add at least one filler.");
          return;
      }

      const dataToSend = {
          fillers: fillers,
          fields: placedFields.map(({id, ...rest}) => rest), // Don't need the React-specific ID
          // In a real app, you would also send the file or a reference to it
      };

      console.log('--- Sending Data to Backend ---');
      console.log(JSON.stringify(dataToSend, null, 2));
      alert('Document data prepared for sending! Check the browser console for the payload.');
  };


  return (
    <DndProvider backend={HTML5Backend}>
        <div className="flex h-screen bg-gray-100 font-sans">
            {/* Sidebar */}
            <div className="w-80 bg-white shadow-md p-6 flex flex-col">
                <h1 className="text-2xl font-bold mb-2 text-gray-800">E-Signature</h1>
                <p className="text-sm text-gray-500 mb-6">Upload, place fields, and send.</p>

                <div className="mb-6">
                    <label htmlFor="pdf-upload" className={`block text-sm font-medium mb-2 ${!isPdfJsReady ? 'text-gray-400' : 'text-gray-700'}`}>
                      {isPdfJsReady ? '1. Upload PDF' : 'Loading PDF Library...'}
                    </label>
                    <input ref={fileInputRef} type="file" id="pdf-upload" onChange={onFileChange} accept=".pdf" className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed" disabled={!isPdfJsReady}/>
                </div>

                {pdf && (
                    <>
                        <div className="mb-6">
                            <h2 className="text-sm font-medium text-gray-700 mb-2">2. Add Fields</h2>
                            <p className="text-xs text-gray-500 mb-3">Drag these onto the document.</p>
                            <DraggableField type="Signature" label="🖋️ Signature" />
                            <DraggableField type="Text" label="📄 Text Input" />
                            <DraggableField type="Date" label="📅 Date" />
                        </div>

                        <div className="mb-6 flex-grow overflow-y-auto min-h-[100px]">
                            <h2 className="text-sm font-medium text-gray-700 mb-2">3. Add Fillers</h2>
                            <div className="flex mb-3">
                                <input 
                                    type="email" 
                                    value={newFillerEmail}
                                    onChange={(e) => setNewFillerEmail(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && addFiller()}
                                    placeholder="filler@example.com"
                                    className="flex-grow p-2 border border-gray-300 rounded-l-md text-sm focus:ring-blue-500 focus:border-blue-500"
                                />
                                <button onClick={addFiller} className="bg-blue-500 text-white px-4 rounded-r-md hover:bg-blue-600 text-sm">Add</button>
                            </div>
                            <div id="filler-list">
                                {fillers.map((filler) => (
                                    <div key={filler.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-md mb-2">
                                        <span className="text-sm text-gray-800 truncate" title={filler.email}>{filler.email}</span>
                                        <button onClick={() => removeFiller(filler.id)} className="text-red-500 hover:text-red-700 text-xl font-bold ml-2">&times;</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button 
                            onClick={handleSend}
                            className="w-full bg-green-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-600 transition-all shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed"
                            disabled={placedFields.length === 0 || fillers.length === 0 || placedFields.some(f => !f.assignedTo)}
                        >
                            Send Document
                        </button>
                    </>
                )}

                 {!pdf && (
                    <div className="flex-grow flex items-center justify-center">
                        <div className="text-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <p className="mt-2 text-sm">{isPdfJsReady ? "Please upload a PDF to begin." : "Initializing..."}</p>
                        </div>
                    </div>
                 )}
            </div>

            {/* PDF Viewer */}
            <div className="flex-1 p-8 overflow-y-auto bg-gray-200">
                <div className="max-w-4xl mx-auto">
                    {pdf ? (
                        Array.from(new Array(numPages), (el, index) => (
                            <PdfPage
                                key={`page_${index + 1}`}
                                pageNum={index + 1}
                                pdf={pdf}
                                onDrop={handleDrop}
                                placedFields={placedFields.filter(f => f.pageNum === index + 1)}
                                onMoveField={handleMoveField}
                                onAssignField={handleAssignField}
                                allFillers={fillers}
                            />
                        ))
                    ) : (
                        <div className="flex justify-center items-center h-full">
                            <div className="text-center p-10 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
                                <h2 className="text-xl font-medium text-gray-500">Document Preview Area</h2>
                                <p className="text-gray-400">Your uploaded PDF will be displayed here.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </DndProvider>
  );
}
