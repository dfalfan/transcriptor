// Definir formData en el alcance global
let formData = {
  fecha: $("#fecha").val(),
  admision: undefined,
  paciente: undefined,
  cedula: undefined,
  edad: undefined,
  tipoEstudio: undefined,
  doctor: $("#doctor").val(),
  refiere: $("input[name='refiere']").val(),
};

$(document).ready(function () {
  // Enfoca el select cuando se carga la página
  $("#doctor").focus();

  // Manejar el evento de envío del formulario
  $(".formulario form").submit(function (e) {
    e.preventDefault(); // Prevenir el envío por defecto

    // Actualiza los valores restantes de formData
    formData.fecha = $("#fecha").val();
    formData.doctor = $("#doctor").val();
    formData.refiere = $("input[name='refiere']").val();

    // Obtiene los estudio_id de las opciones seleccionadas en lista2
    let lista2 = document.getElementById("lista2");
    let selectedEstudioIds = Array.from(lista2.options)
      .filter((option) => option.selected)
      .map((option) => option.value);

    // Actualiza formData con los estudio_id seleccionados
    formData.idEstudio = selectedEstudioIds;

    // Enviar formData a la ruta /store_idEstudio en el servidor
    $.ajax({
      url: "/store_idEstudio",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ idEstudio: formData.idEstudio }),
      success: function (response) {
        console.log(response);
      },
      error: function (error) {
        console.log(error);
      },
    });

    // Validación de campos (por simplicidad, solo se muestra el proceso para el campo 'fecha')
    if (formData.fecha === "") {
      $("#fecha").addClass("error");
      alert("Por favor, complete todos los campos requeridos.");
      return; // Detener la ejecución si hay campos sin llenar
    }

    // Guardar en LocalStorage
    localStorage.setItem("selectedData", JSON.stringify(formData));
    console.log("Datos almacenados:", formData);

    // Ocultar elementos del formulario y mostrar otros elementos
    $(".formulario").hide(); // Ocultar el formulario
    $(".containerprincipal").show(); // Mostrar otros elementos que desees
    $("#info-box").show(); // Muestra el elemento con el id "info-box"

    updateInfoBox();

    // Obtén una referencia al elemento de entrada del archivo
    var fileInput = document.getElementById("manual-audio-upload");

    // Agrega un event listener para el evento 'change'
    fileInput.addEventListener("change", function () {
      // Cuando el usuario selecciona un archivo, habilita los botones
      document.getElementById("transcribe-button").disabled = false;
      document.getElementById("correct-button").disabled = false;
    });

    //Paginacion
    // Buscar la cantidad de páginas que necesita el médico seleccionado
    let paginas = paginasPorDoctor[formData.doctor];

    // Vaciar la paginación existente
    $(".pagination").empty();

    // Generar los botones de paginación
    for (let i = 1; i <= paginas; i++) {
      $(".pagination").append(`
        <div class="page-container">
          <button class="page-button">${i}</button>
          <hr class="line" />
        </div>
      `);
    }

    // Añadir el botón de "check" al final
    $(".pagination").append(`
      <div class="page-container">
        <button class="page-button" value="check">✓</button>
      </div>
    `);

    // Manejar el evento de clic en los botones de paginación
    $(".page-button").click(function () {
      // Eliminar la clase 'active' de todos los botones
      $(".page-button").removeClass("active");

      // Añadir la clase 'active' al botón que se hizo clic
      $(this).addClass("active");

      // Ocultar todo el contenido de la página
      $(".page-content").hide();

      // Mostrar el contenido de la página correspondiente al botón que se hizo clic
      let pageToShow =
        $(this).val() === "check" ? "pagecheck" : "page" + $(this).text();
      $("#" + pageToShow).show();

      // Si el botón que se hizo clic es "check", activar el evento de clic del botón "generatePdfButton"
      if ($(this).val() === "check") {
        $("#generatePdfButton").click();
      }
    });

    // Seleccionar por defecto la página 1
    $(".page-button:first").click();
  });
});

// Función para guardar en servidor
function saveSelectedData(data) {
  return fetch("/save-selected-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

//Guardar texto seleccionado en memoria
var selectionStart, selectionEnd;

$("#filtered_text").on("focusout", function () {
  // Guardar la selección de texto
  selectionStart = this.selectionStart;
  selectionEnd = this.selectionEnd;
  var selectedText = this.value.substring(selectionStart, selectionEnd);
  //console.log("Selected text: '" + selectedText + "'");
});

$("#filtered_text").on("focus", function () {
  // Restaurar la selección de texto
  this.setSelectionRange(selectionStart, selectionEnd);
  var selectedText = this.value.substring(selectionStart, selectionEnd);
  // console.log("Selected text: '" + selectedText + "'");
});

function updateInfoBox() {
  // Asegurarse de que hay datos para mostrar
  if (localStorage.getItem("selectedData")) {
    let storedData = JSON.parse(localStorage.getItem("selectedData"));

    // Actualizar los contenidos del cuadro informativo
    $("#info-paciente-nombre").text(storedData.paciente || "No especificado");
    $("#info-medico-nombre").text(storedData.doctor || "No especificado");
    $("#info-admision-numero").text(storedData.admision || "No especificado");
    $("#info-tipo-estudio-nombre").text(
      storedData.tipoEstudio || "No especificado"
    );
  }
}

// Fecha
$(document).ready(function () {
  var today = new Date();
  var day = today.getDate();
  var month = today.getMonth() + 1; // El mes sin ceros iniciales
  var year = today.getFullYear();
  var formattedDay = day <= 9 ? "0" + day : day.toString(); // Agregar cero inicial si el mes es menor o igual a 9
  var formattedMonth = month <= 9 ? "0" + month : month.toString(); // Agregar cero inicial si el mes es menor o igual a 9
  var formattedDate = formattedDay + "-" + formattedMonth + "-" + year;
  $("input[name='fecha']")
    .val(formattedDate)
    .datepicker({
      dateFormat: "dd-mm-yy",
      altFormat: "dd-mm-yy",
      altField: "input[name='fecha']",
      onSelect: function () {
        loadAdmissions(); // Llama a la función cuando se selecciona una fecha
      },
    });

  loadAdmissions(); // Llama a la función cuando la página se carga
});

// Variable global para almacenar todas las admisiones
var allAdmissions = [];

// Al inicio, lista2 no tiene la clase 'show'
document.getElementById("lista2").classList.remove("show");
document.getElementById("info-seleccion").classList.remove("show");
document.querySelector("#info-seleccion #estudio").classList.remove("show");
document.getElementById("next-button").classList.remove("show");

//cambio al select del médico
document.getElementById("doctor").addEventListener("change", function () {
  // Si se selecciona un médico, carga las admisiones
  if (this.value) {
    loadAdmissions();
  } else {
    // Si no se selecciona un médico, vacía la lista de admisiones
    var lista1 = document.getElementById("lista1");
    lista1.innerHTML = "";
  }
});

document.getElementById("lista1").addEventListener("change", function () {
  // Si se selecciona un paciente, añade la clase 'show' a lista2 e info-seleccion
  if (this.value) {
    document.getElementById("lista2").classList.add("show");
    document.getElementById("info-seleccion").classList.add("show");
    loadDetails(this.value);
  } else {
    // Si no se selecciona un paciente, quita la clase 'show' de lista2, info-seleccion, estudio y next-button
    document.getElementById("lista2").classList.remove("show");
    document.getElementById("info-seleccion").classList.remove("show");
    document.querySelector("#info-seleccion #estudio").classList.remove("show");
    document.getElementById("next-button").classList.remove("show");
  }
});

document.getElementById("lista2").addEventListener("change", function () {
  let selectedEstudioId = this.value; // El estudio_id del estudio seleccionado

  let selectedOptions = Array.from(this.options)
    .filter((option) => option.selected)
    .map((option) => option.textContent);

  // Actualiza el texto del elemento "estudio" con las opciones seleccionadas
  document.querySelector("#info-seleccion #estudio").textContent =
    selectedOptions.join(", ");

  // Si se seleccionó al menos un estudio, muestra el label "estudio:" y el botón "next-button"
  if (selectedOptions.length > 0) {
    document.querySelector("#info-seleccion #estudio").classList.add("show");
    document.getElementById("next-button").classList.add("show");
  } else {
    // Si no se seleccionó ningún estudio, oculta el label "estudio:" y el botón "next-button"
    document.querySelector("#info-seleccion #estudio").classList.remove("show");
    document.getElementById("next-button").classList.remove("show");
  }

  // Aquí puedes hacer lo que necesites con selectedEstudioId
});

//funcion para cargar admisiones
function loadAdmissions() {
  var doctor = document.getElementById("doctor").value;
  if (!doctor) {
    var lista1 = document.getElementById("lista1");
    lista1.innerHTML = "";
    return;
  }

  var fecha = document.getElementById("fecha").value;
  fetch("/get_admissions_by_date", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fecha: fecha, medico: doctor }),
  })
    .then((response) => response.json())
    .then((data) => {
      var lista1 = document.getElementById("lista1");
      lista1.innerHTML = "";

      data.admisiones.sort((a, b) => a.paciente.localeCompare(b.paciente));

      var addedAdmissions = new Set();

      data.admisiones.forEach((admision, index) => {
        if (!addedAdmissions.has(admision.admision)) {
          var option = document.createElement("option");
          option.value = admision.admision;
          option.textContent = admision.admision + " - " + admision.paciente;
          addedAdmissions.add(admision.admision);

          var selectedAdmissions = data.admisiones.filter(
            (a) => a.admision == admision.admision
          );

          // Crea una promesa para cada estudio en selectedAdmissions
          var studyInfoPromises = selectedAdmissions.map((a) =>
            fetch(`/get_study_info/${a.estudio_id}`).then((response) =>
              response.json()
            )
          );

          // Cuando todas las promesas se resuelvan...
          Promise.all(studyInfoPromises).then((studiesInfo) => {
            // Verifica si todos los estudios están informados
            var allStudiesInformed = studiesInfo.every((info) => info[3] == 1);

            if (allStudiesInformed) {
              option.classList.add("informed-study");
              option.textContent = option.textContent + " ☑️"; // Añade el icono de checkbox al final
            } else {
              option.classList.remove("informed-study");
            }

            setTimeout(() => {
              option.classList.add("show");
              lista1.appendChild(option);
            }, index * 25);
          });
        }
      });

      allAdmissions = data.admisiones;
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

//funcion para cargar detalles
function loadDetails(admision) {
  var lista2 = document.getElementById("lista2");
  lista2.innerHTML = "";
  lista2.setAttribute("multiple", ""); // Agrega el atributo "multiple" a tu elemento select

  // Busca todos los registros que coincidan con la admisión seleccionada
  var selectedAdmissions = allAdmissions.filter((a) => a.admision == admision);

  selectedAdmissions.forEach((admision) => {
    var option = document.createElement("option");
    option.value = admision.estudio_id; // Usa estudio_id como el valor de la opción
    option.textContent = admision.name + " " + admision.detalle; // Muestra "name - detalle"
    lista2.appendChild(option);
  });

  // Actualiza la información de la selección
  var infoSeleccion = document.getElementById("info-seleccion");
  infoSeleccion.querySelector("#nombre").textContent =
    selectedAdmissions[0].paciente;
  infoSeleccion.querySelector("#edad").textContent = selectedAdmissions[0].edad;
  infoSeleccion.querySelector("#cedula").textContent =
    selectedAdmissions[0].cedula;
  infoSeleccion.querySelector("#estudio").textContent = selectedAdmissions
    .map((a) => a.name)
    .join(", "); // Muestra todos los estudios

  // Actualiza formData con los detalles de la admisión seleccionada
  formData.admision = selectedAdmissions[0].admision;
  formData.paciente = selectedAdmissions[0].paciente;
  formData.cedula = selectedAdmissions[0].cedula;
  formData.edad = selectedAdmissions[0].edad;
  formData.estudio_id = selectedAdmissions.map((a) => a.estudio_id); // Guarda todos los estudio_id

  // Obtiene los estudio_id de las opciones seleccionadas en lista2
  let selectedEstudioIds = Array.from(lista2.options)
    .filter((option) => option.selected)
    .map((option) => option.value);

  // Actualiza formData con los estudio_id seleccionados
  formData.tipoEstudio = selectedEstudioIds;

  // Después de cargar los elementos en lista2, verifica si cada estudio está informado
  for (let i = 0; i < lista2.options.length; i++) {
    let option = lista2.options[i];

    // Para cada estudio_id, hace una solicitud al servidor para obtener la información del estudio
    fetch(`/get_study_info/${option.value}`)
      .then((response) => response.json())
      .then((data) => {
        // Si el estudio está informado, agrega la clase CSS y el icono de checkbox
        if (data[3]) {
          option.classList.add("informed-study");
          option.textContent = option.textContent + " ☑️"; // Añade el icono de checkbox al final
        } else {
          // Si el estudio no está informado, quita la clase CSS
          option.classList.remove("informed-study");
        }
      });
  }

  //console.log("Valor de formData:", formData);
}

// Evento change para lista1
document.getElementById("lista1").addEventListener("change", function () {
  for (let i = 0; i < this.options.length; i++) {
    let option = this.options[i];
    if (option.selected) {
      option.classList.add("selected-option");
    } else {
      option.classList.remove("selected-option");
    }
  }
});

// Evento change para lista2
document.getElementById("lista2").addEventListener("change", function () {
  for (let i = 0; i < this.options.length; i++) {
    let option = this.options[i];
    if (option.selected) {
      option.classList.add("selected-option");
    } else {
      option.classList.remove("selected-option");
    }
  }

  // Obtiene los nombres de los estudios y los estudio_id de las opciones seleccionadas
  let selectedEstudios = Array.from(this.options)
    .filter((option) => option.selected)
    .map((option) => option.textContent);
  let selectedEstudioIds = Array.from(this.options)
    .filter((option) => option.selected)
    .map((option) => option.value);

  // Actualiza formData con los nombres de los estudios seleccionados y los estudio_id
  formData.tipoEstudio = selectedEstudios;
  formData.idEstudio = selectedEstudioIds;

  // Si se seleccionó al menos un estudio, muestra el label "estudio:" y el botón "next-button"
  if (selectedEstudios.length > 0) {
    // Actualiza el texto del elemento "estudio" con las opciones seleccionadas
    document.querySelector(
      "#info-seleccion #label_estudio #estudio"
    ).textContent = selectedEstudios.join(", ");
    document.querySelector("#info-seleccion #label_estudio").style.display =
      "block";
    document.getElementById("next-button").classList.add("show");
  } else {
    // Si no se seleccionó ningún estudio, oculta el label "estudio:" y el botón "next-button"
    document.querySelector("#info-seleccion #label_estudio").style.display =
      "none";
    document.getElementById("next-button").classList.remove("show");
  }

  // Para cada estudio_id seleccionado, hace una solicitud al servidor para obtener la información del estudio
  selectedEstudioIds.forEach((estudio_id) => {
    fetch(`/get_study_info/${estudio_id}`)
      .then((response) => response.json())
      .then((data) => {
        // Si el estudio está informado, muestra los detalles
        if (data[3]) {
          document.querySelector(
            "#info-seleccion #label_estudio_informado"
          ).style.display = "block";
          document.querySelector(
            "#info-seleccion #estudio_informado"
          ).textContent = "Sí";
          document.querySelector(
            "#info-seleccion #label_medico_informante"
          ).style.display = "block";
          document.querySelector(
            "#info-seleccion #medico_informante"
          ).textContent = data[0];
          document.querySelector(
            "#info-seleccion #label_fecha_informado"
          ).style.display = "block";

          moment.locale("es");
          var fecha = new Date(data[1]);
          var fechaFormateada = moment
            .utc(fecha)
            .format("dddd, DD MMMM YYYY, hh:mm:ss A");
          document.querySelector(
            "#info-seleccion #fecha_informado"
          ).textContent = fechaFormateada;

          // Muestra el enlace al estudio y actualiza el atributo href con la ubicación del estudio
          document.querySelector("#label_estudio_link").style.display = "block";
          document.querySelector(
            "#estudio_link"
          ).href = `https://transcriptor.prevaler.com/api/${data[4]}`; // Asume que data[4] contiene el ID del informe

          // Muestra la línea de división
          document.querySelector("#divider").style.display = "block";

          // Oculta el botón "next-button" y elimina la clase 'show'
          let nextButton = document.querySelector("#next-button");
          nextButton.style.display = "none";
          nextButton.classList.remove("show");
        } else {
          // Si el estudio no está informado, no muestra los detalles
          document.querySelector(
            "#info-seleccion #label_estudio_informado"
          ).style.display = "none";
          document.querySelector(
            "#info-seleccion #label_medico_informante"
          ).style.display = "none";
          document.querySelector(
            "#info-seleccion #label_fecha_informado"
          ).style.display = "none";

          // Oculta el enlace al estudio
          document.querySelector("#label_estudio_link").style.display = "none";

          // Oculta la línea de división
          document.querySelector("#divider").style.display = "none";

          // Muestra el botón "next-button" y añade la clase 'show'
          let nextButton = document.querySelector("#next-button");
          nextButton.style.display = "block";
          nextButton.classList.add("show");
        }
      });
  });

  // Evento focus para lista1
  document.getElementById("lista1").addEventListener("focus", function () {
    // Limpia los datos de los estudios
    document.querySelector(
      "#info-seleccion #label_estudio #estudio"
    ).textContent = "";
    document.querySelector("#info-seleccion #label_estudio").style.display =
      "none";
    document.querySelector(
      "#info-seleccion #label_estudio_informado"
    ).style.display = "none";
    document.querySelector("#info-seleccion #estudio_informado").textContent =
      "";
    document.querySelector(
      "#info-seleccion #label_medico_informante"
    ).style.display = "none";
    document.querySelector("#info-seleccion #medico_informante").textContent =
      "";
    document.querySelector(
      "#info-seleccion #label_fecha_informado"
    ).style.display = "none";
    document.querySelector("#info-seleccion #fecha_informado").textContent = "";

    // Oculta el enlace al estudio, su etiqueta y la línea divisoria
    document.querySelector(
      "#info-seleccion #label_estudio_link"
    ).style.display = "none";
    document.querySelector("#info-seleccion #estudio_link").href = "";
    document.querySelector("#divider").style.display = "none";

    document.getElementById("next-button").classList.remove("show");
  });
});

// Medicos y doctores
var selectDoctor = document.querySelector("#doctor");

opcionesDoctor.forEach(function (opcion) {
  var option = document.createElement("option");
  option.value = opcion;
  option.textContent = opcion;
  selectDoctor.appendChild(option);
});

document.addEventListener("DOMContentLoaded", function () {
  // Encabezados
  function updateEncabezados(doctorSeleccionado) {
    const encabezados = headersByDoctor[doctorSeleccionado] || [];
    const encabezadoSelect = document.getElementById("encabezado-select");

    // Limpiar select de encabezados actuales, manteniendo el placeholder
    encabezadoSelect.innerHTML =
      '<option value="" disabled selected>Seleccione</option>';

    // Llenar select de encabezados
    encabezados.forEach((encabezado) => {
      const option = document.createElement("option");
      option.value = encabezado.texto; // El valor del option será el texto del encabezado
      option.textContent = encabezado.titulo; // El texto del option será el título del encabezado
      encabezadoSelect.appendChild(option);
    });
  }

  // Evento para cuando se selecciona un doctor
  document.getElementById("doctor").addEventListener("change", function () {
    updateEncabezados(this.value);
  });

  // Evento para cuando se selecciona un encabezado
  document
    .getElementById("encabezado-select")
    .addEventListener("change", function () {
      const selectedEncabezado = this.value;
      anadirAlTextarea(selectedEncabezado, "header_text");
    });

  function anadirAlTextarea(texto, textareaId) {
    const textarea = document.getElementById(textareaId);
    textarea.value = texto + "\n\n"; // Reemplaza el texto existente en lugar de añadirlo
  }

  //Plantillas
  function updatePlantillas(doctorSeleccionado) {
    const plantillas = templatesByDoctor[doctorSeleccionado] || [];
    const plantillaSelect = document.getElementById("plantilla-select");

    // Limpiar select de plantillas actuales, manteniendo el placeholder
    plantillaSelect.innerHTML =
      '<option value="" disabled selected>Seleccione</option>';

    // Llenar select de plantillas
    plantillas.forEach((plantilla) => {
      const option = document.createElement("option");
      option.value = plantilla.texto; // El valor del option será el texto de la plantilla
      option.textContent = plantilla.titulo; // El texto del option será el título de la plantilla
      plantillaSelect.appendChild(option);
    });
  }

  // Evento para cuando se selecciona un doctor (plantilla)
  document.getElementById("doctor").addEventListener("change", function () {
    updatePlantillas(this.value);
  });

  // Evento para cuando se selecciona una plantilla
  document
    .getElementById("plantilla-select")
    .addEventListener("change", function () {
      const selectedPlantilla = this.value;
      anadirAlTextarea(selectedPlantilla, "filtered_text");
    });

  // Función para ocultar o mostrar el botón según el contenido del textarea (TRANSCRIBIR)
  function updateTranscribeButton() {
    const transcribeButton = document.getElementById("transcribe-button");
    const filteredText = document.getElementById("filtered_text");

    if (filteredText.value.trim() === "") {
      // Si el textarea está vacío, mostrar el botón
      transcribeButton.style.display = "block";
    } else {
      // Si el textarea no está vacío, ocultar el botón
      transcribeButton.style.display = "none";
    }
  }

  // Asignar updateTranscribeButton al objeto window para hacerla global
  window.updateTranscribeButton = updateTranscribeButton;

  // Evento para cuando se introduce o se elimina texto en el textarea
  document
    .getElementById("filtered_text")
    .addEventListener("input", updateTranscribeButton);

  // Evento para cuando se selecciona una plantilla
  document
    .getElementById("plantilla-select")
    .addEventListener("change", function () {
      const selectedPlantilla = this.value;
      anadirAlTextarea(selectedPlantilla, "filtered_text");

      // Actualizar el estado del botón después de cambiar el contenido del textarea
      updateTranscribeButton();
    });

  // Función para ocultar o mostrar el botón según el contenido del textarea (CORREGIR)
  function updateCorrectButton() {
    const correctButton = document.getElementById("correct-button");
    const filteredText = document.getElementById("filtered_text");

    if (filteredText.value.trim() === "") {
      // Si el textarea está vacío, ocultar el botón
      correctButton.style.display = "none";
    } else {
      // Si el textarea no está vacío, mostrar el botón
      correctButton.style.display = "block";
    }
  }

  // Asignar updateCorrectButton al objeto window para hacerla global
  window.updateCorrectButton = updateCorrectButton;

  // Evento para cuando se introduce o se elimina texto en el textarea
  document
    .getElementById("filtered_text")
    .addEventListener("input", updateCorrectButton);

  // Evento para cuando se selecciona una plantilla
  document
    .getElementById("plantilla-select")
    .addEventListener("change", function () {
      const selectedPlantilla = this.value;
      anadirAlTextarea(selectedPlantilla, "filtered_text");

      // Actualizar el estado del botón después de cambiar el contenido del textarea
      updateCorrectButton();
    });
});

//Imagen de firma
function compareDoctorName() {
  var doctorSelect = document.getElementById("doctor");
  var selectedDoctor = doctorSelect.options[doctorSelect.selectedIndex].text;

  var imageName = selectedDoctor + ".png";
  var imagePath = "static/firmas/" + imageName;

  // Haz algo con la ruta de la imagen, como mostrarla en una vista previa
  // document.getElementById("firma-preview").src = imagePath;
}

//DROPZONES
var dropzones = document.querySelectorAll(".dropzone");

// Añade el evento 'click' a cada botón de pegado
dropzones.forEach(function (dropzone, index) {
  var pasteButton = document.getElementById("paste-button" + (index + 1));

  pasteButton.addEventListener("click", function (e) {
    navigator.clipboard.read().then(function (items) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].types.indexOf("image/png") > -1) {
          var blob = items[i].getType("image/png");
          blob.then(function (blob) {
            var img = document.createElement("img");
            var url = URL.createObjectURL(blob);
            img.src = url;

            // Si ya existe una imagen en el dropzone, la elimina
            var existingImage = dropzone.querySelector("img");
            if (existingImage) {
              dropzone.removeChild(existingImage);
            }

            // Añade la nueva imagen
            dropzone.appendChild(img);

            // Convierte el blob en un FormData y envíalo al servidor
            var formData = new FormData();
            formData.append("image", blob, "image.png");

            fetch("/upload_image", {
              method: "POST",
              body: formData,
            });
          });
        }
      }
    });
  });
});

// Oculta el botón "approveStudyButton" por defecto
$("#approveStudyButton").hide();

// Generar PDF
$("#generatePdfButton").click(function (e) {
  // Evita que el formulario se envíe de inmediato
  e.preventDefault();

  // Oculta el visor de PDF
  $("embed").hide();

  // Muestra el div de carga
  $("#loadingpdf").show();

  // Copia el valor de filtered_text a edited_filtered_text
  var filtered_text = $("#filtered_text").val();
  $("#edited_filtered_text").val(filtered_text);

  // Copia los valores de los campos del formulario original a los campos correspondientes en el formulario con la clase `topdf`
  $("#edited_filtered_textxx").val($("#edited_filtered_text").val());

  var header_text = $("#header_text").val();

  $("#header_textxx").val(header_text);
  $("#fechaxx").val(formData.fecha);
  $("#admisionxx").val(formData.admision);
  $("#pacientexx").val(formData.paciente);
  $("#cedulaxx").val(formData.cedula);
  $("#edadxx").val(formData.edad);
  $("#tipo_estudioxx").val(formData.tipoEstudio);
  $("#doctorxx").val(formData.doctor);
  $("#refierexx").val($("#refiere").val()); // Añade esta línea

  // Ahora obtén el valor de cada campo en el formulario `topdf`
  $(".topdf").each(function () {
    // Aquí puedes trabajar con cada campo
    var campo = $(this).attr("id");
    var valor = $(this).val();
  });

  // Envía el formulario
  $.post("/download", $(this).closest("form").serialize(), function (filename) {
    // Actualiza el visor de PDF para mostrar el nuevo PDF
    $("embed").attr("src", "/static/pdfs/" + filename);

    // Muestra el visor de PDF
    $("embed").show();
    $("#approveStudyButton").show();

    // Oculta el div de carga
    $("#loadingpdf").hide();
  });
});
