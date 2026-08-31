const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const validFileId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);

function safeBaseName(filename) {
  const name = path.posix.basename(path.win32.basename(filename));
  return (
    path
      .parse(name)
      .name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .slice(0, 100)
      .replace(/[. ]+$/g, '') || 'file'
  );
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${Number((bytes / 1024 ** unit).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB'][unit]}`;
}

function createFileStorage(directory) {
  directory = path.resolve(directory);
  fs.mkdirSync(directory, { recursive: true });

  async function save(buffer, outputFilename, metadata) {
    const fileId = crypto.randomBytes(12).toString('hex');
    const filePath = path.join(directory, `${fileId}_${outputFilename}`);
    const result = {
      ...metadata,
      fileId,
      outputFilename,
      downloadUrl: `/api/download/${fileId}`,
      createdAt: Date.now()
    };
    try {
      await fs.promises.writeFile(filePath, buffer);
      const { preview, ...diskMetadata } = result;
      await fs.promises.writeFile(
        path.join(directory, `${fileId}_meta.json`),
        JSON.stringify(diskMetadata)
      );
      return result;
    } catch (error) {
      await fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }
  }

  async function get(fileId) {
    if (!validFileId(fileId)) return null;
    try {
      const metadata = JSON.parse(
        await fs.promises.readFile(
          path.join(directory, `${fileId}_meta.json`),
          'utf8'
        )
      );
      if (
        metadata.fileId !== fileId ||
        typeof metadata.outputFilename !== 'string'
      )
        return null;
      if (/[\\/\x00-\x1f]/.test(metadata.outputFilename)) return null;
      const filePath = path.join(
        directory,
        `${fileId}_${metadata.outputFilename}`
      );
      // Only serve the exact generated regular file, never a prefix match or symlink.
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      return { ...metadata, filePath };
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
        console.error('Cannot read download:', error.message);
      return null;
    }
  }

  return { save, get };
}

module.exports = { createFileStorage, safeBaseName, formatBytes, validFileId };
