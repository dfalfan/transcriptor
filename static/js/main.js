document.addEventListener('DOMContentLoaded', function() {
    var audioFilename = document.getElementById('audio-filename');
    var inputFile = document.querySelector('input[type="file"]');

    inputFile.addEventListener('change', function() {
        var file = this.files[0];
        var filename = getFilenameWithoutExtension(file.name);
        audioFilename.textContent = filename;
    });

    function getFilenameWithoutExtension(filename) {
        return filename.replace(/\.[^/.]+$/, '');
    }
});