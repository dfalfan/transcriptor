# Hecho por Daniel Falfán.
# banderita
from flask import (
    Flask,
    render_template,
    request,
    session,
    make_response,
    url_for,
    send_file,
    send_from_directory,
    jsonify,
)
from datetime import datetime
from werkzeug.utils import secure_filename
from flask_cors import CORS
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.units import inch
from reportlab.platypus import Image
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import openai
import whisperx
import spacy
import os
import uuid
import tempfile
import re
import ntpath
import io
import win32com.client
import time
import threading
import win32wnet
import pythoncom
import mysql.connector
import shutil
import logging
from ssl import SSLEOFError
from waitress import serve


db_config = {
    "host": "192.168.5.25",
    "user": "root",
    "password": "",
    "database": "serviturno_im",
}


app = Flask(__name__)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = False
CORS(app)
nlp = spacy.load("es_core_news_sm")
app.secret_key = b"\x80\xf7\xc7\x06\x86\xd1\x1b\xe4\x8bl\x86\xdc\xf2\xa9\xa0\x80\x91\x13\xd2#\x9f+\xad\xf3"


# Ruta para archivos estáticos
app.static_folder = "static"
device = "cuda"

# Cargar modelo
model = whisperx.load_model("large-v2", device, language="es")

app.config["UPLOAD_FOLDER"] = os.path.join(app.static_folder, "uploads")

openai.api_key = os.environ["OPENAI_API_KEY"]


class TimerThread(threading.Thread):
    def __init__(self):
        super(TimerThread, self).__init__()
        self.start_time = time.time()
        self.running = True

    def run(self):
        while self.running:
            print(
                "\rTiempo transcurrido: {:.2f} segundos. ".format(
                    time.time() - self.start_time
                ),
                end="",
            )
            time.sleep(1)

    def stop(self):
        self.running = False


def get_filename_without_extension(filename):
    base = ntpath.basename(filename)
    return os.path.splitext(base)[0]


def get_database_connection():
    return mysql.connector.connect(**db_config)


@app.after_request
def log_response_info(response):
    if response.direct_passthrough:
        app.logger.debug("Response is in direct passthrough mode.")
    else:
        app.logger.debug("Body: %s", response.get_data())
    return response


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/get_patient_data", methods=["POST"])
def get_patient_data():
    admision_number = request.json.get("admision")

    if admision_number:
        try:
            # Conexión a BD
            connection = get_database_connection()
            cursor = connection.cursor(dictionary=True)

            # Consulta combinada con JOIN para obtener todos los datos necesarios
            query = """
            SELECT c.paciente, c.cedula, c.edad, te.name, COALESCE(ct.detalle, '') AS detalle, ct.estudio_id
            FROM cola c
            LEFT JOIN cola_tipo ct ON c.id = ct.cola_id
            LEFT JOIN tipo_estudio te ON ct.tipo_estudio_id = te.id
            WHERE c.admision = %s
            """
            cursor.execute(query, (admision_number,))
            results = cursor.fetchall()

            # Procesar los resultados y construir la respuesta
            if results:
                patient_data = {
                    "paciente": results[0]["paciente"],
                    "cedula": results[0]["cedula"],
                    "edad": results[0]["edad"],
                }
                tipos = ", ".join(
                    f"{row['name']} {row['detalle']}".strip()
                    for row in results
                    if row["name"]
                )
                return jsonify(patient_data=patient_data, tipo_estudio=tipos)
            else:
                return jsonify(patient_data={}, tipo_estudio=[])
        except mysql.connector.Error as err:
            print("Error en la base de datos:", err)
            return jsonify(error=str(err)), 500
        finally:
            cursor.close()
            connection.close()
    else:
        return jsonify(patient_data={}, tipo_estudio=[])


@app.route("/get_admissions_by_date", methods=["POST"])
def get_admissions_by_date():
    # Obtén la fecha y el médico del cuerpo de la solicitud
    fecha = request.json.get("fecha")
    medico = request.json.get("medico")

    # Convierte la fecha al formato 'YYYY-MM-DD'
    fecha = datetime.strptime(fecha, "%d-%m-%Y").strftime("%Y-%m-%d")

    # Limpiar los nombres de archivo de imagen de la sesión
    session.pop("image_filenames", None)

    if fecha and medico:
        try:
            # Conexión a BD
            connection = get_database_connection()
            cursor = connection.cursor(dictionary=True)

            # Consulta para obtener todas las admisiones de la fecha seleccionada y el médico seleccionado
            query = """
            SELECT c.admision, c.paciente, c.cedula, c.edad, te.name, COALESCE(ct.detalle, '') AS detalle, ct.estudio_id
            FROM cola c
            LEFT JOIN cola_tipo ct ON c.id = ct.cola_id
            LEFT JOIN tipo_estudio te ON ct.tipo_estudio_id = te.id
            INNER JOIN medico_categoria mc ON te.id_categoria = mc.id_categoria
            WHERE DATE(c.fecha) = %s AND mc.medico = %s AND c.tecnico IS NOT NULL AND TRIM(c.tecnico) <> ''
            ORDER BY c.admision, ct.estudio_id
            """
            cursor.execute(query, (fecha, medico))
            results = cursor.fetchall()

            # Devuelve los resultados como una respuesta JSON
            return jsonify(
                admisiones=results, pacientes=[result["paciente"] for result in results]
            )
        except mysql.connector.Error as err:
            print("Error en la base de datos:", err)
            return jsonify(error=str(err)), 500
        finally:
            cursor.close()
            connection.close()
    else:
        return jsonify(admisiones=[])


def obtener_cola_ids(admision, cursor):
    query = "SELECT id FROM cola WHERE admision = %s"
    cursor.execute(query, (admision,))

    cola_ids = []
    for row in cursor:
        cola_ids.append(row["id"])

    return cola_ids


def obtener_tipos_estudio(cola_ids, cursor):
    tipos_detalle = []
    estudio_ids = []

    for cola_id in cola_ids:
        tipo_estudio_query = """
        SELECT ct.estudio_id, te.name, COALESCE(ct.detalle, '') AS detalle
        FROM cola_tipo ct  
        JOIN tipo_estudio te ON ct.tipo_estudio_id = te.id
        WHERE ct.cola_id = %s
        """

        cursor.execute(tipo_estudio_query, (cola_id,))

        # Consume todos los resultados
        results = cursor.fetchall()

        # Concatenar nombre y detalle, y luego agregar a la lista de tipos_detalle
        for row in results:
            nombre_con_detalle = f"{row['name']} {row['detalle']}".strip()
            tipos_detalle.append(nombre_con_detalle)

    # Unir todos los tipos en una cadena separada por comas
    tipos = ", ".join(tipos_detalle)
    return tipos


@app.route("/save-selected-data", methods=["POST"])
def save_selected_data():
    data = request.get_json()
    print(data)

    session["data"] = data
    return "Ok"


@app.route("/transcribe", methods=["POST"])
def transcribe():
    audio_file = request.files["audio_file"]
    print("Iniciando la ruta /transcribe")
    timer = TimerThread()
    timer.start()

    if audio_file:
        # Obtener el nombre del archivo original con su extensión
        audio_filename_with_extension = secure_filename(audio_file.filename)
        audio_file.save(
            os.path.join(app.config["UPLOAD_FOLDER"], audio_filename_with_extension)
        )

        uploads_folder = app.config["UPLOAD_FOLDER"]
        audio_path = os.path.join(uploads_folder, audio_filename_with_extension)
        audio = whisperx.load_audio(audio_path)

        # Usa el modelo ya cargado para transcribir el audio
        transcription = model.transcribe(audio)

        full_text = ""
        for segment in transcription["segments"]:
            full_text += segment["text"]

        print("full_text:", full_text)

        # Obtener la extensión del archivo para determinar el tipo MIME
        file_extension = os.path.splitext(audio_filename_with_extension)[1]
        audio_type = "audio/mp3" if file_extension == ".mp3" else "audio/webm"
        audio_url = url_for(
            "static", filename="uploads/" + audio_filename_with_extension
        )

        # Enviar el texto final a la API de OpenAI

        prompt = [
            {
                "role": "user",
                "content": "Esto es una transcripción de un audio dictada por un médico radiólogo. La transcripción está realizada por Whisper, pero requiere edición como si el doctor estuviera dictando a una persona para transcribir. Corrige la ortografía y sustituye palabras incorrectas. Elimina todas las indicaciones del doctor al transcriptor y cualquier interacción humana. Corrige errores gramaticales de Whisper. Mantén fielmente todos los diagnósticos y el orden en que se presentan sin omitir ni inventar información, ya que es un informe médico. Respeta todas las medidas dadas (ejemplo: 0.5x0.6 cm). El texto siempre debe comenzar por Hallazgos, omite el nombre el tipo de estudio etc. El formato es así \n\nHallazgos:\n- Descripción de hallazgos en formato de lista con viñetas.\n\nConclusión:\nCada punto de la conclusión debe comenzar en una nueva línea y NO debe ser precedido por viñetas. Por ejemplo:\nObservación1.\nObservación2.\nObservación3.\n\nRecomendaciones:\nSi no hay recomendaciones, no incluir esta sección. Evita agregar comentarios tuyos y asegúrate de que las conclusiones no estén en formato de viñetas. Los BI-RADS siempre serán en números romanos (ejemplo Bi-Rads II)",
            },
            {"role": "assistant", "content": "Texto:"},
            {"role": "user", "content": full_text},
        ]

        response = openai.ChatCompletion.create(
            model="gpt-4-0125-preview",
            messages=prompt,
            max_tokens=1000,
            temperature=0.2,
        )

        timer.stop()
        print("El proceso de OpenAI ha finalizado.")
        # Obtener el texto generado por el modelo de ChatGPT
        openai_text = response.choices[0].message["content"]
        session["openai_text"] = openai_text

        # Después de obtener el texto de openai, se filtra
        tipo_estudio_index = openai_text.find("Tipo de Estudio:")

        if tipo_estudio_index != -1:
            # Cortar el texto después de "Tipo de Estudio:"
            lines = openai_text[tipo_estudio_index:].split("\n")[1:]
            filtered_text = "\n".join(lines)
        else:
            filtered_text = openai_text

        # Guardar el texto filtrado en la sesión
        session["filtered_text"] = filtered_text

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            # Devuelve el texto filtrado como respuesta
            return jsonify(filtered_text=filtered_text)

        print("Transcripción finalizada con éxito.")
        return render_template(
            "index.html",
            transcription=full_text,
            audio_path=audio_path,
            audio_filename=audio_filename_with_extension,
            audio_url=audio_url,
            audio_type=audio_type,
            openai_text=openai_text,
            filtered_text=filtered_text,
        )

        return render_template(
            "index.html", error="No se ha cargado ningún archivo de audio."
        )


# Guardamos el texto en un txt temporal para las posteriores modificaciones hechas por un humano
@app.route("/save_filtered_text", methods=["POST"])
def save_filtered_text():
    filtered_text = request.json["filtered_text"]

    # Generar un nombre único para el archivo .txt
    unique_filename = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}.txt")

    with open(unique_filename, "w") as file:
        file.write(filtered_text)

    return "Texto guardado exitosamente"


@app.route("/fix", methods=["POST"])
def fix_text():
    print("Iniciando la ruta /fix")
    timer = TimerThread()
    timer.start()
    audio_file = request.files["audio_file"]

    if audio_file:
        # Obtener el nombre del archivo original con su extensión
        audio_filename_with_extension = secure_filename(audio_file.filename)
        audio_file.save(
            os.path.join(app.config["UPLOAD_FOLDER"], audio_filename_with_extension)
        )

        uploads_folder = app.config["UPLOAD_FOLDER"]
        audio_path = os.path.join(uploads_folder, audio_filename_with_extension)
        audio = whisperx.load_audio(audio_path)

        # Usa el modelo ya cargado para transcribir el audio
        transcription = model.transcribe(audio)

        full_text = ""
        for segment in transcription["segments"]:
            full_text += segment["text"]

        print("full_text:", full_text)

        # Obtener la extensión del archivo para determinar el tipo MIME
        file_extension = os.path.splitext(audio_filename_with_extension)[1]
        audio_type = "audio/mp3" if file_extension == ".mp3" else "audio/webm"
        audio_url = url_for(
            "static", filename="uploads/" + audio_filename_with_extension
        )

        filtered_text = request.form["filtered_text"]

        # Enviar el texto final a la API de OpenAI
        prompt = [
            {
                "role": "user",
                "content": "Este texto es la transcripción de un audio con Whisper de un médico, él está dando instrucciones de lo que minimamente se debe corregir en el texto. Modificar el texto según las correcciones. Mantén todo tal cual está, repito, el formato de hallazgos y conclusion con bulletpoints debe mantenerse, solo modifica ESTRICTAMENTE la parte que se menciona en el audio, no des opiniones ni mensajes adicionales, no coloques titulos como 'texto corregido:' ni nada similar.",
            },
            {"role": "assistant", "content": "Texto actual:"},
            {
                "role": "user",
                "content": filtered_text,
            },
            {"role": "assistant", "content": "Instrucciones de corrección:"},
            {
                "role": "user",
                "content": full_text,
            },
        ]

        response = openai.ChatCompletion.create(
            model="gpt-4-0125-preview",
            messages=prompt,
            max_tokens=1000,
            temperature=0.2,
        )

        timer.stop()
        print("El proceso de OpenAI ha finalizado.")
        # Obtener el texto generado por el modelo de ChatGPT
        openai_text = response.choices[0].message["content"]
        session["openai_text"] = openai_text

        # Después de obtener el texto de openai, se filtra
        tipo_estudio_index = openai_text.find("Tipo de Estudio:")

        if tipo_estudio_index != -1:
            # Cortar el texto después de "Tipo de Estudio:"
            lines = openai_text[tipo_estudio_index:].split("\n")[1:]
            filtered_text = "\n".join(lines)
        else:
            filtered_text = openai_text

        # Guardar el texto filtrado en la sesión
        session["filtered_text"] = filtered_text

        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            # Devuelve el texto filtrado como respuesta
            return jsonify(filtered_text=filtered_text)

        return render_template(
            "index.html",
            transcription=full_text,
            audio_path=audio_path,
            audio_filename=audio_filename_with_extension,
            audio_url=audio_url,
            audio_type=audio_type,
            openai_text=openai_text,
            filtered_text=filtered_text,
        )

        return render_template(
            "index.html", error="No se ha cargado ningún archivo de audio."
        )


@app.route("/upload_image", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return "No se encontró la imagen en la solicitud", 400

    file = request.files["image"]
    filename = secure_filename(f"{uuid.uuid4()}.png")
    file.save(os.path.join("static/uploads/images", filename))

    # Obtener la lista de nombres de archivo de la sesión
    image_filenames = session.get("image_filenames", [])

    # Agregar el nuevo nombre de archivo a la lista
    image_filenames.append(filename)

    # Almacenar la lista actualizada en la sesión
    session["image_filenames"] = image_filenames

    # Imprimir el nombre del archivo
    print(f"Nombre del archivo de imagen: {filename}")

    return filename, 200


@app.route("/clear_session", methods=["POST"])
def clear_session():
    # Eliminar 'image_filenames' de la sesión
    session.pop("image_filenames", None)

    # Imprimir un mensaje para confirmar que 'image_filenames' ha sido eliminado de la sesión
    print("'image_filenames' ha sido eliminado de la sesión")

    return "'image_filenames' ha sido eliminado de la sesión", 200


@app.route("/download", methods=["POST"])
def download():
    print("Inicio del proceso de descarga")
    # Obtener textos de la sesión
    openai_text = session.get("openai_text")
    filtered_text = session.get("filtered_text")
    header_text = request.form.get("header_text", "")
    edited_filtered_text = request.form["edited_filtered_text"]

    # Obtener los valores del formulario
    tipo_estudio = request.form["tipo_estudio"]
    refiere = request.form["refiere"]
    paciente = request.form["paciente"]
    cedula = request.form["cedula"]
    edad = request.form["edad"]
    fecha = request.form["fecha"]
    admision = request.form["admision"]
    doctor = request.form["doctor"]

    session["doctor"] = doctor  # Guardar doctor en la sesión

    print(f"paciente: {paciente}")
    print(f"tipo_estudio: {tipo_estudio}")
    print(f"fecha: {fecha}")
    print(f"admision: {admision}")
    print(f"cedula: {cedula}")
    print(f"doctor: {doctor}")
    print(f"refiere: {refiere}")

    # Generar un nombre de archivo temporal único
    transcription_filename = f"{admision}_{cedula}_{paciente}_{tipo_estudio}_{fecha}_"
    transcription_filename = transcription_filename.replace(
        "/", "-"
    )  # Reemplazar / con -

    # Generar el nombre del archivo PDF
    pdf_filename = f"{transcription_filename}.pdf"
    pdf_filename = pdf_filename.replace("/", "-")  # Reemplazar / con -

    print(f"pdf_filename: {pdf_filename}")

    # Guardar pdf_filename en la sesión
    session["pdf_filename"] = pdf_filename

    # Crear un nuevo PDF con Reportlab
    c = canvas.Canvas(
        os.path.join(tempfile.gettempdir(), pdf_filename), pagesize=letter
    )
    
    #Fuentes
    pdfmetrics.registerFont(TTFont('SNPro', 'static/fonts/SNPro-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('SNPro-Bold', 'static/fonts/SNPro-Bold.ttf')) 

    # Agregar metadatos al PDF
    c.setAuthor(doctor)
    c.setTitle(tipo_estudio)
    c.setSubject(paciente)
    c.setKeywords([cedula, edad, fecha, admision])

    # Convertir el color hexadecimal #212121 a valores RGB normalizados
    r, g, b = 33/255.0, 33/255.0, 33/255.0

    # Agregar la imagen de marca de agua
    marca_agua_path = "static/marcadiagua2.png"
    page_width, page_height = letter

    # Calcular el nuevo tamaño y posición para centrar la imagen
    # Asumiendo que quieres hacer la imagen un poco más ancha
    escala_ancho = 0.5  # Escala para el ancho
    escala_alto = 0.5  # Escala para el alto
    nuevo_ancho = page_width * escala_ancho * 1.1  # Hacer la imagen un 10% más ancha
    nuevo_alto = page_height * escala_alto

    # Calcular las nuevas coordenadas x, y para centrar la imagen
    x = (page_width - nuevo_ancho) / 2
    y = (page_height - nuevo_alto) / 2

    c.drawImage(marca_agua_path, x, y, width=nuevo_ancho, height=nuevo_alto, mask='auto')

    # Añadir la imagen de cabecera por encima del logo
    cabeza = "static/cabeza1.png"  # Reemplaza esto con la ruta de tu imagen 'cabeza.png'
    cabeza_height = 50  # Ajusta la altura de la imagen 'cabeza.png' según tus necesidades
    c.drawImage(
    cabeza, 0, 700 + cabeza_height, width=620, height=cabeza_height
    )  # Ajusta las coordenadas y el tamaño según tus necesidades

    
    # Agregar la imagen del logo
    logo = "static/pdflogo.png"  # Reemplaza esto con la ruta de tu logo
    c.drawImage(
        logo, 50, 720, width=160, height=50
    )  # Ajusta las coordenadas y el tamaño según tus necesidades

    # Crear un objeto textobject
    textobject = c.beginText()

    # Establecer la posición inicial del texto
    textobject.setTextOrigin(50, 700)  # Reducir la separación entre el logo y el texto

    # Asumiendo que ya has creado el objeto textobject y has establecido su posición inicial

    # Establecer la fuente normal para el texto
    textobject.setFont("SNPro", 9)

  
    # Repetir para cada línea que necesites
    textobject.setFont("SNPro-Bold", 10)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut("Fecha: ")
    textobject.setFont("SNPro", 9)
    textobject.setFillColorRGB(r, g, b)
    textobject.textLine(fecha)

    textobject.setFont("SNPro-Bold", 10)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut("Paciente: ")
    textobject.setFont("SNPro", 9)
    textobject.setFillColorRGB(r, g, b)
    textobject.textLine(paciente)

    textobject.setFont("SNPro-Bold", 10)  
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut("Edad: ")  
    textobject.setFont("SNPro", 9)  
    textobject.setFillColorRGB(r, g, b)
    textobject.textLine(edad)  
    
    textobject.setFont("SNPro-Bold", 10)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut("Cédula: ")
    textobject.setFont("SNPro", 9)
    textobject.setFillColorRGB(r, g, b)
    textobject.textLine(cedula)

    textobject.setFont("SNPro-Bold", 10)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut("Estudio: (")
    textobject.setFont("SNPro-Bold", 9)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut(tipo_estudio)
    textobject.setFont("SNPro-Bold", 10)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut(")")
    textobject.textLine("")  # Finalizar la línea

    textobject.setFont("SNPro-Bold", 10)
    textobject.setFillColorRGB(r, g, b)
    textobject.textOut("Médico Informante: ")
    textobject.setFont("SNPro", 9)
    textobject.setFillColorRGB(r, g, b)
    textobject.textLine(doctor)

    if refiere.strip():
        textobject.setFont("SNPro-Bold", 10)
        textobject.setFillColorRGB(r, g, b)
        textobject.textOut("Refiere: ")
        textobject.setFont("SNPro", 9)
        textobject.setFillColorRGB(r, g, b)
        textobject.textLine(refiere)

    # Agregar el tipo de estudio como título en el centro
    c.setFont("SNPro-Bold", 14)
    textobject.setFillColorRGB(r, g, b)
    title_text = "Informe"  
    #title_text = "" + tipo_estudio
    title_width = stringWidth(title_text, "SNPro-Bold", 14)
    title_x = letter[0] / 2
    title_y = 610
    c.drawCentredString(title_x, title_y, title_text)

    # Dibujar una línea debajo del título para subrayarlo
    c.line(
        title_x - title_width / 2, title_y - 5, title_x + title_width / 2, title_y - 5
    )
    # Dibujar el texto
    c.drawText(textobject)

    # Agregar el texto del ENCABEZADO
    textobject = c.beginText()
    y = 580  # Inicializar y
    textobject.setTextOrigin(50, y)  # Ajusta la posición según tus necesidades
    textobject.setFont(
        "SNPro", 11
    )  # Ajusta el tamaño de la fuente según tus necesidades
    textobject.setFillColorRGB(r, g, b)

    # Divide el header_text en palabras y agrega cada palabra al textobject
    for word in header_text.split():
        if (
            textobject.getX() + stringWidth(word, "SNPro", 12) > letter[0] - 50
        ):  # Comprobar si la palabra se sale del margen derecho
            y -= 14  # Mover el cursor a la siguiente línea
            textobject.setTextOrigin(50, y)
        textobject.textOut(word + " ")  # Agregar la palabra y un espacio

    c.drawText(textobject)

    # Crear un nuevo objeto textobject para el TEXTO
    textobject = c.beginText()

    # Establecer la posición inicial del texto
    y -= 30  # Comenzar desde debajo del título, ajusta el valor según tus necesidades
    textobject.setTextOrigin(50, y)

    # Establecer el tamaño del texto
    textobject.setFont("SNPro", 11)
    textobject.setFillColorRGB(r, g, b)

    # Agregar el texto editado y filtrado
    first_page = True
    for line in edited_filtered_text.split("\n"):
        words = line.split()
        for word in words:
            if (
                textobject.getX() + stringWidth(word, "SNPro", 12) > letter[0] - 50
            ):  # Comprobar si la palabra se sale del margen derecho
                y -= 14  # Mover el cursor a la siguiente línea
                textobject.setTextOrigin(50, y)
            if y < 134:  # Comprobar si el texto se sale del margen superior
                c.drawText(textobject)
                c.showPage()  # Comenzar una nueva página
                textobject = c.beginText()  # Crear un nuevo objeto textobject
                y = (
                    700 if not first_page else 580
                )  # Comenzar desde la parte superior de la nueva página
                textobject.setTextOrigin(50, y)
            textobject.textOut(word + " ")  # Agregar la palabra y un espacio
        textobject.textOut(" ")  # Agregar un espacio en blanco al final de la línea
        y -= 14  # Mover el cursor a la siguiente línea después de cada línea de texto
        textobject.setTextOrigin(50, y)
        first_page = False
        
    # Dibujar el texto
    c.drawText(textobject)
    
    # Generar la ruta de la imagen de la firma del doctor seleccionado
    firma_filename = f"{doctor}.png"
    firma_path = os.path.join("static/firmas", firma_filename)

    # Verificar si la imagen de la firma existe
    if os.path.exists(firma_path):
        # Ajusta las coordenadas y el tamaño según tus necesidades
        image_width = 180
        image_height = 90
        page_width = letter[0]
        image_x = (page_width - image_width) / 2
        c.drawImage(firma_path, image_x, 50, width=image_width, height=image_height)
    else:
        # Si no se encuentra la imagen, se puede utilizar una imagen de firma genérica o mostrar un mensaje de error
        # c.drawImage("ruta_de_la_imagen_generica.png", 50, 50, width=160, height=50)
        pass

    
    # Añadir la imagen 'piedepagina.png' debajo de la firma
    piedepagina_path = "static/piedepagina1.png"  # Asegúrate de que esta sea la ruta correcta a tu imagen
    # Ajusta el tamaño de la imagen de pie de página según tus necesidades
    piedepagina_width = 620
    piedepagina_height = 40
    # Calcular la posición X de manera similar a la firma para centrarla
    piedepagina_x = (page_width - piedepagina_width) / 2
    # La posición Y es la posición inicial de la firma menos la altura de la firma y un pequeño margen si es necesario
    piedepagina_y = 50 - piedepagina_height - 10  # Ajusta el margen según necesites

    c.drawImage(piedepagina_path, piedepagina_x, piedepagina_y, width=piedepagina_width, height=piedepagina_height)

    # Agregar una nueva página al PDF
    c.showPage()

    # Dropzone imagenes
    # Obtener los nombres de los archivos de las imágenes de la sesión
    image_filenames = session.get("image_filenames", [])

    # Inicializar el contador de imágenes por página
    images_per_page = 0

    for i, image_filename in enumerate(image_filenames):
        # Verificar si se necesitan más páginas
        if images_per_page >= 2:
            c.showPage()  # Comenzar una nueva página
            images_per_page = 0  # Restablecer el contador de imágenes por página

        # Generar la ruta de la imagen
        image_path = os.path.join("static/uploads/images", image_filename)

        # Verificar si la imagen existe
        if os.path.exists(image_path):
            # Ajusta las coordenadas y el tamaño según tus necesidades
            image_width = 300
            image_height = 300
            page_height = letter[1]
            margin = 40  # Ajustar el margen según tus necesidades

            # Calcular la posición x e y para una sola columna de imágenes
            image_x = (letter[0] - image_width) / 2  # Centrar la imagen en la página
            # Calcular la posición y en función del índice de la imagen en la página
            image_y = page_height - margin - (images_per_page + 1) * (image_height + margin)

            c.drawImage(image_path, image_x, image_y, width=image_width, height=image_height)

            images_per_page += 1  # Incrementar el contador de imágenes por página
        else:
            print(f"La imagen {image_path} no existe")  # Imprimir si la imagen no existe

    # Guardar el PDF después de procesar todas las imágenes
    c.save()

    # Guardar pdf_path en la sesión
    pdf_path = os.path.join("static", "pdfs", pdf_filename)
    session["pdf_path"] = pdf_path
    # Copiar el archivo al directorio static/pdfs
    shutil.copy(os.path.join(tempfile.gettempdir(), pdf_filename), pdf_path)

    return pdf_filename


@app.route("/store_idEstudio", methods=["POST"])
def store_idEstudio():
    # Obtener los datos enviados en la solicitud POST
    data = request.get_json()

    # Obtener idEstudio de los datos
    idEstudio = data.get("idEstudio")

    # Imprimir el valor de idEstudio
    print(f"Valor de idEstudio: {idEstudio}")

    # Si idEstudio es una lista, convertir todos los elementos a int
    if isinstance(idEstudio, list):
        idEstudio = [int(id) for id in idEstudio if id.isdigit()]

    # Verificar que idEstudio es una lista de números
    if not all(isinstance(id, int) for id in idEstudio):
        return "Error: idEstudio debe ser una lista de números.", 400

    # Almacenar idEstudio en la sesión
    session["idEstudio"] = idEstudio

    return "idEstudio almacenado en la sesión", 200


@app.route("/approve_study", methods=["POST"])
def approve_study():
    edited_filtered_text = request.form.get("edited_filtered_text")
    header_text = request.form.get("header_text")

    pdf_filename = session.get("pdf_filename")  # Obtener pdf_filename de la sesión
    pdf_path = session.get("pdf_path")  # Obtener pdf_path de la sesión

    if isinstance(pdf_path, list):
        return "Error: pdf_path es una lista.", 500

    idEstudio = session.get("idEstudio")  # Obtener idEstudio de la sesión

    if not isinstance(idEstudio, list):
        return "Error: idEstudio debe ser una lista.", 500

    # Obtener fecha y doctor de la sesión o de donde sea que los estés almacenando
    fecha = datetime.now().strftime("%Y-%m-%d")
    doctor = session.get("doctor")

    # Comprobar si doctor es None
    if doctor is None:
        return "Error: doctor no está en la sesión.", 500

    # Divide edited_filtered_text en hallazgos y conclusion
    splitText = edited_filtered_text.split("Conclusión:")
    hallazgos = splitText[0]
    conclusion = splitText[1] if len(splitText) > 1 else ""
    print(f"{hallazgos}")  # Imprime el valor de splitText
    print(f"{conclusion}")  # Imprime el valor de splitText

    # Añade header_text al principio de hallazgos
    hallazgos = header_text + hallazgos

    # Autenticar con el nas
    win32wnet.WNetAddConnection2(
        0,
        None,
        r"\\192.168.5.12\dicom\_pdf",  # Ruta de red
        None,
        os.environ["NAS_USERNAME"],  # Nombre de usuario
        os.environ["NAS_PASSWORD"],  # Contraseña
    )

    # Crear la ruta de destino con las carpetas de fecha y doctor
    destination_path = os.path.join("\\\\192.168.5.12\\dicom\\_pdf\\", fecha, doctor)

    # Crear la ruta completa del archivo, incluyendo el nombre del archivo
    complete_destination_path = os.path.join(destination_path, pdf_filename)

  # Crear la ruta completa del archivo, incluyendo el nombre del archivo
    complete_destination_path = os.path.join(destination_path, pdf_filename)

    # Verificar si el archivo ya existe
    counter = 1
    while os.path.exists(complete_destination_path):
        # Si el archivo ya existe, modificar el nombre del archivo
        base, extension = os.path.splitext(pdf_filename)
        pdf_filename = f"{base}_{counter}{extension}"
        complete_destination_path = os.path.join(destination_path, pdf_filename)
        counter += 1

    # Crear las carpetas si no existen
    os.makedirs(destination_path, exist_ok=True)

    try:
        shutil.copy(pdf_path, complete_destination_path)  # Copiar el archivo

        if idEstudio is None:
            return "Error: estudio_id no está en la sesión.", 500

        db = get_database_connection()  # Obtener la conexión a la base de datos

        with db.cursor() as cursor:
            for estudio_id in idEstudio:
                # Actualizar ruta_estudio
                cursor.execute(
                    "UPDATE cola_tipo SET ruta_estudio = %s WHERE estudio_id = %s",
                    (complete_destination_path, estudio_id),
                )

                # Establecer el idioma a español
                cursor.execute("SET lc_time_names = 'es_ES'")

                # Actualizar medico_informante, estudio_informado y fecha_informado
                cursor.execute(
                    """
                    UPDATE cola_tipo 
                    SET medico_informante = %s, 
                        estudio_informado = 1, 
                        fecha_informado = DATE_FORMAT(NOW(), '%%W, %%d %%M %%Y %%r'),
                        hallazgos = %s,
                        conclusion = %s
                    WHERE estudio_id = %s
                    """,
                    (doctor, hallazgos, conclusion, estudio_id),
                )
            db.commit()  # Confirmar los cambios en la base de datos
        print(
            "-----------------------------------Estudio aprobado y PDF copiado con éxito.----------------------------------"
        )
        return "Estudio aprobado y PDF copiado con éxito."

    except Exception as e:
        return str(e), 500


@app.route("/get_study_info/<int:estudio_id>")
def get_study_info(estudio_id):
    db = get_database_connection()
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT medico_informante, fecha_informado, ruta_estudio, estudio_informado, estudio_id
            FROM cola_tipo
            WHERE estudio_id = %s
            """,
            (estudio_id,),
        )
        result = cursor.fetchone()
    return jsonify(result)


@app.route("/api/<informe>")
def download_file(informe):

    # Conecta a la base de datos y obtén la ruta del archivo del estudio con el ID especificado
    db = get_database_connection()
    with db.cursor() as cursor:
        cursor.execute(
            "SELECT ruta_estudio FROM cola_tipo WHERE estudio_id = %s", (informe,)
        )
        row = cursor.fetchone()

    if row is None:
        return "No se encontró ningún estudio con ese ID", 404

    file_path = row[0]
    print(f"file_path: {file_path}")  # Imprime el valor de file_path

    # Devuelve el archivo si existe
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, mimetype="application/pdf")
    else:
        return "Archivo no encontrado", 404


if __name__ == "__main__":
    serve(app, host="0.0.0.0", port=8080)
