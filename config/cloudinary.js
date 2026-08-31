const cloudinary = require('cloudinary').v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

let isConfigured = false;

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });
  isConfigured = true;
  console.log('☁️ Cloudinary SDK configured successfully.');
} else {
  console.warn('⚠️ Cloudinary credentials missing. Files will be served via local fallback streams.');
}

/**
 * Upload buffer directly to Cloudinary
 */
const uploadBufferToCloudinary = (buffer, folder = 'omnitools', resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    if (!isConfigured) {
      return resolve(null); // Fallback to local server response
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary Upload Error:', error);
          return reject(error);
        }
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
};

module.exports = {
  cloudinary,
  isConfigured: () => isConfigured,
  uploadBufferToCloudinary
};
