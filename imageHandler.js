const vision = require('@google-cloud/vision');
const path = require('path');
const { GOOGLE_APPLICATION_CREDENTIALS } = process.env;

const client = new vision.ImageAnnotatorClient({
  keyFilename: path.join(__dirname, GOOGLE_APPLICATION_CREDENTIALS),
});

async function analyzeImage(attachmentUrl) {
  const features = [
    { type: 'LABEL_DETECTION' },
    { type: 'OBJECT_LOCALIZATION' },
    { type: 'TEXT_DETECTION' },
    { type: 'FACE_DETECTION' },
  ];

  const [result] = await client.annotateImage({
    image: { source: { imageUri: attachmentUrl } },
    features,
  });

  const labels = result.labelAnnotations;
  const objects = result.localizedObjectAnnotations;
  const texts = result.textAnnotations;
  const faces = result.faceAnnotations;

  const description = {
    labels: labels.map(label => label.description).join(', '),
    objects: objects.map(object => object.name).join(', '),
    texts: texts.map(text => text.description).join(', '),
    faces: faces.length > 0 ? `I found ${faces.length} face(s) in the image.` : '',
  };

  return description;
}

module.exports = {
  analyzeImage,
};