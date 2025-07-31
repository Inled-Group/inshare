// Licencia GNU-GPL v3.0
// Creado por Inled Group en 2025
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 8080;

// Crear directorio de uploads si no existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configurar multer para el manejo de archivos grandes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Mantener el nombre original del archivo con timestamp para evitar conflictos
    const timestamp = Date.now();
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, timestamp + '-' + originalName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB límite (aumentado significativamente)
  }
});

// Middleware
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));

// Aumentar límites para archivos grandes
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Función para obtener la IP local
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (let devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}

// Función para formatear el tamaño de archivo
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Store para trackear descargas
const downloadTracker = new Map();

// Ruta principal - servir el HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Ruta para obtener información de red
app.get('/api/network-info', (req, res) => {
  const localIP = getLocalIP();
  res.json({
    networkUrl: 'http://' + localIP + ':' + PORT
  });
});

// Endpoint para progreso de subida
app.post('/upload-progress', (req, res) => {
  let uploadedBytes = 0;
  let totalBytes = parseInt(req.headers['content-length']) || 0;
  
  req.on('data', (chunk) => {
    uploadedBytes += chunk.length;
    // Enviar progreso via Server-Sent Events si es necesario
  });
  
  req.on('end', () => {
    res.json({ message: 'Upload progress tracked' });
  });
});

// Ruta para subir archivos con soporte para archivos grandes
app.post('/upload', (req, res) => {
  const multerUpload = upload.array('files');
  
  multerUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
          error: 'Archivo demasiado grande. Límite: 10GB por archivo' 
        });
      }
      console.error('Error de multer:', err);
      return res.status(500).json({ error: 'Error al procesar archivos' });
    }
    
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No se seleccionaron archivos' });
      }

      const uploadedFiles = req.files.map(file => {
        // Decodificar correctamente el nombre del archivo
        let originalName;
        try {
          originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        } catch (e) {
          originalName = file.originalname;
        }
        
        return {
          originalName: originalName,
          filename: file.filename,
          size: formatFileSize(file.size),
          sizeBytes: file.size
        };
      });

      console.log('Archivos subidos:', uploadedFiles);
      res.json({ 
        success: true, 
        message: uploadedFiles.length + ' archivo(s) subido(s) correctamente',
        files: uploadedFiles 
      });
    } catch (error) {
      console.error('Error al subir archivos:', error);
      res.status(500).json({ error: 'Error al subir archivos' });
    }
  });
});

// Ruta para listar archivos
app.get('/files', (req, res) => {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
      return res.json([]);
    }

    const files = fs.readdirSync(uploadsDir)
      .filter(filename => {
        // Filtrar archivos ocultos y directorios
        return !filename.startsWith('.') && fs.statSync(path.join(uploadsDir, filename)).isFile();
      })
      .map(filename => {
        const filePath = path.join(uploadsDir, filename);
        const stats = fs.statSync(filePath);
        
        // Extraer nombre original del archivo
        let originalName = filename.replace(/^\d+-/, '');
        
        return {
          filename: filename,
          originalName: originalName,
          size: formatFileSize(stats.size),
          sizeBytes: stats.size,
          uploadDate: stats.mtime.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        };
      });

    // Ordenar por fecha de modificación (más reciente primero)
    files.sort((a, b) => {
      const aPath = path.join(uploadsDir, a.filename);
      const bPath = path.join(uploadsDir, b.filename);
      return fs.statSync(bPath).mtime - fs.statSync(aPath).mtime;
    });

    console.log('Archivos encontrados:', files.length);
    res.json(files);
  } catch (error) {
    console.error('Error al listar archivos:', error);
    res.status(500).json({ error: 'Error al listar archivos' });
  }
});

// Ruta para descargar archivos con eliminación automática
app.get('/download/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    
    // Obtener nombre original para la descarga
    const originalName = filename.replace(/^\d+-/, '');
    
    console.log(`Iniciando descarga de: ${originalName}`);
    
    // Configurar headers para descarga
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Stream el archivo para mejor manejo de archivos grandes
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (err) => {
      console.error('Error al leer archivo:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al leer archivo' });
      }
    });
    
    fileStream.on('end', () => {
      console.log(`Descarga completada: ${originalName}`);
      
      // Eliminar archivo después de la descarga
      setTimeout(() => {
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('Error al eliminar archivo después de descarga:', err);
          } else {
            console.log(`Archivo eliminado automáticamente: ${originalName}`);
          }
        });
      }, 1000); // Esperar 1 segundo para asegurar que la descarga termine
    });
    
    // Pipe el stream al response
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Error en descarga:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al procesar descarga' });
    }
  }
});

// Ruta para eliminar archivos manualmente
app.delete('/delete/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`Archivo eliminado manualmente: ${filename}`);
    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar archivo:', error);
    res.status(500).json({ error: 'Error al eliminar archivo' });
  }
});

// Middleware para manejo de errores de archivos grandes
app.use((error, req, res, next) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Archivo demasiado grande. El límite es de 10GB por archivo.'
    });
  }
  next(error);
});

// Limpieza periódica de archivos antiguos (opcional - cada 24 horas)
setInterval(() => {
  console.log('Ejecutando limpieza de archivos antiguos...');
  try {
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas
    
    files.forEach(filename => {
      const filePath = path.join(uploadsDir, filename);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`Archivo eliminado por antigüedad: ${filename}`);
      }
    });
  } catch (error) {
    console.error('Error en limpieza automática:', error);
  }
}, 24 * 60 * 60 * 1000); // 24 horas

// Iniciar servidor con configuración optimizada para archivos grandes
const server = app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`
    *******
    *******
    *******
     ******
    =======   ========         =======  =======            ================  ==============
    =======   =========        =======  =======            ================  =================
    =======   ==========       =======  =======            ================  ===================
    =======   ===========      =======  =======            ======+           =======    =========
    =======   =============    =======  =======            ======+           =======      ========
    =======   ==============   =======  =======            ===============   =======       ========
    =======   ===============  =======  =======            ===============   =======       ========
    =======   =======  ======= =======  =======            ===============   =======       ========
    =======   =======   ==============  =======            ===============   =======       ========
    =======   =======    =============  =======            ======+           =======      ========
    =======   =======     ============  =======            ======+           =======    =========
    =======   =======      ===========  =================  ================  ===================
    =======   =======        =========  =================  ================  ==================
    =======   =======         ========  =================  ================  ===============
  `);
  console.log('We make a better world');
  console.log('🚀 Servidor InShare iniciado correctamente (Modo Archivos Grandes)');
  console.log('📦 Límite de archivo: 10GB');
  console.log('🗑️  Auto-eliminación: Activada tras descarga');
  console.log('📡 Accesos disponibles:');
  console.log('   Local: http://localhost:' + PORT);
  console.log('   Red:   http://' + localIP + ':' + PORT);
  console.log('💡 Comparte la URL de red para que otros puedan acceder');
});

// Aumentar timeouts para archivos grandes
server.timeout = 600000; // 10 minutos
server.keepAliveTimeout = 600000;
server.headersTimeout = 600000;