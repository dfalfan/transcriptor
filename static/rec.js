$(document).ready(function () {
  let mediaRecorder;
  let audioChunks = [];
  let recordedBlob = null;
  let isRecording = false;
  let isPaused = false;
  let audioContext = new AudioContext();
  let analyser = audioContext.createAnalyser();
  let microphone;
  let recordingTime = 0;
  let recordingInterval = null;

  const recorder = document.getElementById("recorder");
  const saveRecordingButton = document.getElementById("save-recording");
  const pauseButton = document.getElementById("pause-recording");
  const canvas = document.getElementById("visualizer");
  document.getElementById("transcribe-button").disabled = true;
  document.getElementById("correct-button").disabled = true;

  recorder.addEventListener("click", function () {
    if (!isRecording) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        // Hacer visible el canvas
        canvas.classList.remove("canvas-hidden");

        // Hacer visible el temporizador
        document.getElementById("timer").style.display = "inline-block";

        // Hacer visible el botón de pausa
        pauseButton.style.display = "inline-block";

        // Habilitar el botón de guardar grabación
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
          audioChunks.push(event.data);
        };
        mediaRecorder.onstop = () => {
          recordedBlob = new Blob(audioChunks, { type: "audio/webm" });
          const audioUrl = URL.createObjectURL(recordedBlob);
          document.getElementById("audio-preview").src = audioUrl;
          recorder.classList.remove("recording");
          recorder.classList.add("download");
          pauseButton.disabled = true; // Deshabilita el botón de pausa cuando se detiene la grabación

          // Habilita los botones de transcripción y corrección
          document.getElementById("transcribe-button").disabled = false;
          document.getElementById("correct-button").disabled = false;

          // Elimina la clase "download" después de 5 segundos
          setTimeout(function () {
            recorder.classList.remove("download");
          }, 2000);
        };

        audioChunks = [];
        mediaRecorder.start();
        isRecording = true;
        recorder.classList.add("recording");
        visualize(canvas, audioContext, analyser); // Llamar a visualize después de iniciar la grabación
        pauseButton.disabled = false; // Habilita el botón de pausa

        // Iniciar el contador de tiempo
        recordingTime = 0;
        recordingInterval = setInterval(function () {
          recordingTime++;
          const minutes = Math.floor(recordingTime / 60);
          const seconds = recordingTime % 60;
          document.getElementById("minutes").textContent = minutes
            .toString()
            .padStart(2, "0");
          document.getElementById("seconds").textContent = seconds
            .toString()
            .padStart(2, "0");
        }, 1000);
      });
    } else {
      // Detener grabación
      mediaRecorder.stop();
      isRecording = false;
      recorder.classList.remove("recording");

      microphone.disconnect(analyser);

      canvas.classList.add("canvas-hidden");

      // Restablecer isVisualizing a false
      isVisualizing = false;

      // Detener el contador de tiempo
      clearInterval(recordingInterval);

      // Ocultar el temporizador
      document.getElementById("timer").style.display = "none";

      // Ocultar el botón de pausa
      pauseButton.style.display = "none";

      setTimeout(function () {
        $("#save-recording").trigger("saveRecording");
      }, 1000);
    }
  });

  pauseButton.addEventListener("click", function () {
    if (!isPaused) {
      mediaRecorder.pause();
      isPaused = true;
      pauseButton.classList.add("active"); // Inicia la animación de titilación

      // Pausar el contador de tiempo
      clearInterval(recordingInterval);
    } else {
      mediaRecorder.resume();
      isPaused = false;
      pauseButton.classList.remove("active"); // Detiene la animación de titilación

      // Reanudar el contador de tiempo
      recordingInterval = setInterval(function () {
        recordingTime++;
        const minutes = Math.floor(recordingTime / 60);
        const seconds = recordingTime % 60;
        document.getElementById("minutes").textContent = minutes
          .toString()
          .padStart(2, "0");
        document.getElementById("seconds").textContent = seconds
          .toString()
          .padStart(2, "0");
      }, 1000);
    }
  });

  //Transcribir Grabación
  document
    .getElementById("transcribe-button")
    .addEventListener("click", function (event) {
      if (recordedBlob) {
        event.preventDefault(); // Previene la acción por defecto del formulario

        // Deshabilitar el botón de transcripción inmediatamente después de hacer clic en él
        document.getElementById("transcribe-button").disabled = true;

        let formData = new FormData();
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:.]/g, "")
          .slice(0, 15);
        const filename = "grabacion_" + timestamp + ".webm";
        formData.append("audio_file", recordedBlob, filename);

        // Mostrar el GIF de carga y deshabilitar el textarea
        showLoadingGif();

        $.ajax({
          url: "/transcribe",
          type: "POST",
          data: formData,
          processData: false, // Indica a jQuery que no procese los datos
          contentType: false, // Indica a jQuery que no establezca el tipo de contenido
          dataType: "json", // Espera una respuesta en formato JSON
          success: function (response) {
            // Ocultar el GIF de carga y habilitar el textarea
            hideLoadingGif();

            // Obtener el textarea
            var textarea = document.getElementById("filtered_text");

            // Insertar el texto de la transcripción en la posición actual del cursor
            var cursorPos = textarea.selectionStart;
            var textBefore = textarea.value.substring(0, cursorPos);
            var textAfter = textarea.value.substring(
              cursorPos,
              textarea.value.length
            );
            textarea.value = textBefore + response.filtered_text + textAfter;

            // Actualiza el estado de los botones después de cargar la transcripción
            updateTranscribeButton();
            updateCorrectButton();
            $("#expand-upload-container").hide();

            // Eliminar el audio del elemento <audio>
            document.getElementById("audio-preview").src = "";

            // Habilitar el botón de transcripción en la función de éxito de la llamada AJAX
            document.getElementById("transcribe-button").disabled = false;

            // Establecer recordedBlob a null
            recordedBlob = null;
          },

          error: function (error) {
            // También es buena idea ocultar el GIF de carga y habilitar el textarea en caso de error
            hideLoadingGif();
            console.error("Error al enviar el archivo:", error);
          },
        });
      } else {
      }
      // Si no hay grabación, el formulario se enviará de manera normal
    });

  //Corregir Texto

  $(document).ready(function () {
    $("#correct-button").click(function (event) {
      event.preventDefault(); // Previene la acción por defecto del formulario

      // Deshabilitar el botón de corrección inmediatamente después de hacer clic en él
      document.getElementById("correct-button").disabled = true;

      let formData = new FormData();
      formData.append("filtered_text", $("#filtered_text").val());

      if (recordedBlob) {
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:.]/g, "")
          .slice(0, 15);
        const filename = "grabacion_" + timestamp + ".webm";
        formData.append("audio_file", recordedBlob, filename);
      }

      // Mostrar el GIF de carga y deshabilitar el textarea
      showLoadingGif();

      $.ajax({
        url: "/fix",
        type: "POST",
        data: formData,
        processData: false, // Indica a jQuery que no procese los datos
        contentType: false, // Indica a jQuery que no establezca el tipo de contenido
        dataType: "json", // Espera una respuesta en formato JSON
        success: function (response) {
          // Ocultar el GIF de carga y habilitar el textarea
          hideLoadingGif();

          // Obtener el textarea
          var textarea = document.getElementById("filtered_text");

          // Reemplazar todo el contenido del textarea con la respuesta del servidor
          textarea.value = response.filtered_text;

          // Eliminar el audio del elemento <audio>
          document.getElementById("audio-preview").src = "";

          // Establecer recordedBlob a null
          recordedBlob = null;

          // Habilitar el botón de corrección en la función de éxito de la llamada AJAX
          document.getElementById("correct-button").disabled = false;
        },
        error: function (error) {
          // También es buena idea ocultar el GIF de carga y habilitar el textarea en caso de error
          hideLoadingGif();
          console.error("Error al enviar el archivo:", error);

          // También es buena idea habilitar el botón de corrección en caso de error
          document.getElementById("correct-button").disabled = false;
        },
      });
    });
  });

  //Canvas
  //let isVisualizing = false;

  function visualize(canvas, audioContext, analyser) {
    const canvasCtx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.fftSize = 2048;

    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    isVisualizing = true;

    function draw() {
      if (!isVisualizing) {
        return;
      }

      requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = "#cfcfcf"; // Un gris oscuro

      canvasCtx.beginPath();

      var sliceWidth = (WIDTH * 1.0) / bufferLength;
      var x = 0;

      for (var i = 0; i < bufferLength; i++) {
        var v = dataArray[i] / 128.0;
        var y = (v * HEIGHT) / 2;

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    }

    draw();
  }
});
